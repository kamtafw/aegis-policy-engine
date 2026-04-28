// db/migrations/003_services_and_audit.js
//
// Migration 003 — Services, Routes & Audit Log
//
// SERVICES
//   Upstream services that Aegis acts as a gateway for. Tenant-scoped.
//   is_active allows a service to be disabled without deletion.
//
// ROUTES
//   Individual HTTP routes within a service. Each route carries a policy_id
//   reference — the policy that governs access to that route.
//
//   policy_id is nullable. A route with no policy always denies (AD-S-07).
//   This allows routes to be registered before a policy is assigned,
//   and makes the "no policy = deny" invariant explicit in the schema
//   rather than hidden in application logic.
//
//   Routes are the unit the prefix trie is built from at gateway startup (AD-P-05).
//   The trie is rebuilt on SIGHUP or config reload (Day 18).
//
// AUDIT LOG (AD-S-08)
//   Append-only. Records every gateway decision — allow and deny.
//   Written synchronously to the Redis buffer before the response is dispatched.
//   The drain worker (Day 17) writes from the buffer into this table.
//
//   DELIBERATE DESIGN: tenant_id carries NO FK constraint.
//   Audit records must survive tenant deletion for forensic purposes.
//   If a tenant is deleted, their audit history must remain intact for
//   compliance and investigation. A FK would cascade-delete that history.
//
//   Similarly, principal_id and route_id carry no FKs — the audit record
//   is a historical snapshot, not a live reference.
//
//   The evaluated_policy_version and evaluated_principal_version fields
//   record exactly which versions were active at evaluation time, making
//   every decision reproducible from the audit log alone.
//
// AD refs: AD-S-08, AD-P-05

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export async function up(pgm) {

  // ---------------------------------------------------------------------------
  // services
  // ---------------------------------------------------------------------------
  pgm.createTable("services", {
    id: {
      type: "text",
      primaryKey: true,
      notNull: true,
    },

    tenant_id: {
      type: "text",
      notNull: true,
      references: '"tenants"',
      onDelete: "CASCADE",
    },

    name: {
      type: "text",
      notNull: true,
    },

    // The upstream URL Aegis proxies to on allow decisions.
    // e.g. "https://api.internal.example.com"
    upstream_url: {
      type: "text",
      notNull: true,
    },

    // Soft disable — allows a service to be taken offline without losing
    // its route and policy configuration.
    is_active: {
      type: "boolean",
      notNull: true,
      default: true,
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },

    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // Service names unique within a tenant.
  pgm.addConstraint(
    "services",
    "uq_services_tenant_name",
    "UNIQUE (tenant_id, name)",
  );

  pgm.createIndex("services", "tenant_id", { name: "idx_services_tenant_id" });

  pgm.sql(`
    CREATE TRIGGER trg_services_updated_at
    BEFORE UPDATE ON services
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);


  // ---------------------------------------------------------------------------
  // routes
  // ---------------------------------------------------------------------------
  pgm.createTable("routes", {
    id: {
      type: "text",
      primaryKey: true,
      notNull: true,
    },

    // Routes belong to a service, which belongs to a tenant.
    // tenant_id is stored directly on routes as well for two reasons:
    //   1. All queries against routes are tenant-scoped (AD-S-01) — having
    //      tenant_id here avoids a join to services on every gateway request.
    //   2. The trie lookup returns a route_id; the pipeline can immediately
    //      verify the tenant claim without an extra join.
    service_id: {
      type: "text",
      notNull: true,
      references: '"services"',
      onDelete: "CASCADE",
    },

    tenant_id: {
      type: "text",
      notNull: true,
      references: '"tenants"',
      onDelete: "CASCADE",
    },

    // HTTP method for this route. CHECK constraint keeps invalid methods out.
    method: {
      type: "text",
      notNull: true,
      check: "method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS')",
    },

    // The URL pattern for trie construction (AD-P-05).
    // Supports path parameters: "/users/:userId/orders/:orderId"
    // Exact format is enforced by the ServiceRegistry at write time.
    path_pattern: {
      type: "text",
      notNull: true,
    },

    // The policy that governs access to this route.
    // NULLABLE — a route with no policy attached always denies (AD-S-07).
    // SET NULL on delete: if a policy is deleted, the route stays but loses
    // its policy, which means it immediately starts denying all requests.
    // This is the correct fail-closed behaviour.
    policy_id: {
      type: "text",
      notNull: false,
      references: '"policies"',
      onDelete: "SET NULL",
    },

    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },

    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // A tenant cannot register the same method + path_pattern combination twice
  // within a service — that would create ambiguous trie entries.
  pgm.addConstraint(
    "routes",
    "uq_routes_service_method_path",
    "UNIQUE (service_id, method, path_pattern)",
  );

  // Primary gateway lookup: given a tenant, find the matching route.
  pgm.createIndex("routes", "tenant_id", { name: "idx_routes_tenant_id" });

  // Lookup all routes for a service (trie construction at startup).
  pgm.createIndex("routes", "service_id", { name: "idx_routes_service_id" });

  // Lookup a route's policy (EnforcementPipeline → PolicyPort path).
  pgm.createIndex("routes", "policy_id", { name: "idx_routes_policy_id" });

  pgm.sql(`
    CREATE TRIGGER trg_routes_updated_at
    BEFORE UPDATE ON routes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);


  // ---------------------------------------------------------------------------
  // audit_log
  // ---------------------------------------------------------------------------
  pgm.createTable("audit_log", {
    id: {
      type: "text",
      primaryKey: true,
      notNull: true,
    },

    // NO FK on tenant_id — deliberate (AD-S-08).
    // Audit records must survive tenant deletion for forensic purposes.
    // A FK here would cascade-delete the audit history when a tenant is removed.
    tenant_id: {
      type: "text",
      notNull: true,
    },

    // NO FK on principal_id — same reasoning. The principal may be deleted
    // after the decision was made. The audit record is a historical snapshot.
    principal_id: {
      type: "text",
      notNull: true,
    },

    // NO FK on route_id — routes can be deleted; the audit record must survive.
    route_id: {
      type: "text",
      notNull: true,
    },

    // The action slug from RouteContext — what the principal attempted.
    // e.g. "billing:read", "deploy:execute:staging"
    // Stored as plain text — the slug is the audit language (AD-T-04).
    action: {
      type: "text",
      notNull: true,
    },

    // The policy evaluated. NO FK — policy can be deleted after the fact.
    policy_id: {
      type: "text",
      notNull: true,
    },

    // The binary outcome of the evaluation.
    allowed: {
      type: "boolean",
      notNull: true,
    },

    // Human-readable reason from PolicyEngine naming the deciding permission slug.
    // For ALLOW with ANY: first permission that satisfied the policy.
    // For DENY  with ALL: first permission that was not held.
    // For DENY  with ANY: all required permissions were absent.
    // Must be self-explanatory to a security engineer (AD-T-04).
    reason: {
      type: "text",
      notNull: true,
    },

    // The exact policy_version active when this decision was made.
    // Combined with evaluated_principal_version, makes every decision
    // reproducible from the audit log alone.
    evaluated_policy_version: {
      type: "integer",
      notNull: true,
    },

    // The exact principal_version active when this decision was made.
    evaluated_principal_version: {
      type: "integer",
      notNull: true,
    },

    // Decision timestamp. NOT defaulted — set explicitly by the application
    // at the moment of evaluation, not at the moment of DB write (the drain
    // worker writes asynchronously; the timestamp must reflect evaluation time).
    timestamp: {
      type: "timestamptz",
      notNull: true,
    },

    // No updated_at — audit_log is append-only. There are no updates.
  });

  // Primary query pattern: all decisions for a tenant, newest first.
  pgm.createIndex("audit_log", "tenant_id", { name: "idx_audit_log_tenant_id" });

  // Time-range queries — the audit log viewer filters by date range (Day 22).
  pgm.createIndex("audit_log", "timestamp", { name: "idx_audit_log_timestamp" });

  // Composite — the most common query pattern in the audit viewer:
  // "show me all decisions for this tenant in this time window"
  pgm.createIndex("audit_log", ["tenant_id", "timestamp"], {
    name: "idx_audit_log_tenant_timestamp",
  });

  // Per-principal audit trail — filter by principal within a tenant.
  pgm.createIndex("audit_log", ["tenant_id", "principal_id"], {
    name: "idx_audit_log_tenant_principal",
  });
}


/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export async function down(pgm) {
  pgm.sql("DROP TRIGGER IF EXISTS trg_routes_updated_at   ON routes;");
  pgm.sql("DROP TRIGGER IF EXISTS trg_services_updated_at ON services;");

  // Drop in reverse dependency order.
  // audit_log has no FKs so order relative to others doesn't matter,
  // but keeping it first makes the intent clear.
  pgm.dropTable("audit_log", { ifExists: true });
  pgm.dropTable("routes",    { ifExists: true });
  pgm.dropTable("services",  { ifExists: true });
}