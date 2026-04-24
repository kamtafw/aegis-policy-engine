// Migration 002 — AuthZ Model
//
// Establishes the full authorization domain: roles, permissions, their
// assignments to each other and to principals, and policies.
//
// NOTE ON policy_version:
//   The policy_version counter on tenants was intentionally added in migration
//   001 alongside key_version. The two counters are conceptually paired (AD-P-07)
//   and separating them across migrations would make the invariant harder to see.
//   Nothing to add here.
//
// ROLES (AD-C-05)
//   Role definitions live in the database, not in code. Changing a role's
//   permissions requires no deployment. Roles are tenant-scoped — a role in
//   Tenant A is invisible to Tenant B.
//
// PERMISSIONS (AD-T-01, AD-T-02)
//   Expressed as slugs: resource:action[:specificity]
//   The action vocabulary is closed — enforced via CHECK constraint.
//   The slug column is a Postgres GENERATED ALWAYS AS column: the DB computes
//   it from (resource, action, specificity) and guarantees it is always
//   consistent. No application code can drift it.
//
// ROLE_PERMISSIONS (AD-C-05)
//   Junction between roles and permissions. Both FKs cascade on delete:
//   - Role deleted → assignment row deleted
//   - Permission deleted → assignment row deleted
//   AD-C-04 handles the downstream policy side: required_permissions slugs in
//   the policies table can reference permissions that no longer exist. The
//   evaluator treats missing permissions as unsatisfied — it denies, never errors.
//
// PRINCIPAL_ROLES
//   Junction between principals and roles. Both FKs cascade on delete.
//   AccessControl increments principal_version on any change here (AD-P-08).
//
// POLICIES (AD-C-01, AD-A-04)
//   The policy language is a bounded schema: required_permissions (JSONB array
//   of slugs) + match_strategy (ANY | ALL). No scripting. No conditions.
//   context_version is bound at write time — mismatch at evaluation time is a
//   hard rejection (AD-C-03).
//
// AD refs: AD-C-01, AD-C-04, AD-C-05, AD-T-01, AD-T-02, AD-A-04

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export async function up(pgm) {

  // roles
  pgm.createTable("roles", {
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

  // Role names are unique within a tenant — two tenants can both have a role
  // called "admin" but they are independent records.
  pgm.addConstraint(
    "roles",
    "uq_roles_tenant_name",
    "UNIQUE (tenant_id, name)",
  );

  pgm.createIndex("roles", "tenant_id", { name: "idx_roles_tenant_id" });

  pgm.sql(`
    CREATE TRIGGER trg_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);


  // ---------------------------------------------------------------------------
  // permissions
  // ---------------------------------------------------------------------------
  pgm.createTable("permissions", {
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

    // The resource portion of the slug — e.g. "billing", "deploy", "reports"
    resource: {
      type: "text",
      notNull: true,
      check: "resource ~ '^[a-z0-9-]+$'",
    },

    // The action portion of the slug. Closed vocabulary (AD-T-02).
    // Adding a new action word is a deliberate schema event, not a naming preference.
    action: {
      type: "text",
      notNull: true,
      check: "action IN ('read', 'write', 'delete', 'execute', 'approve', 'export', 'administer')",
    },

    // Optional — narrows scope within a resource: "staging", "restricted", etc.
    // NULL means no specificity suffix: slug = "resource:action"
    specificity: {
      type: "text",
      notNull: false,
      check: "specificity IS NULL OR specificity ~ '^[a-z0-9-]+$'",
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

  // slug — GENERATED ALWAYS AS computed column (AD-T-01)
  //
  // The DB owns slug computation. The application never writes this column.
  // Guarantees: slug is always "resource:action" or "resource:action:specificity",
  // always consistent with its parts, never driftable by application logic.
  //
  // Using pgm.sql() because node-pg-migrate's createTable does not have a
  // 'generated' column option — raw DDL is the reliable path here.
  pgm.sql(`
    ALTER TABLE permissions
    ADD COLUMN slug text GENERATED ALWAYS AS (
      resource || ':' || action || COALESCE(':' || specificity, '')
    ) STORED;
  `);

  // A tenant cannot have two permissions with the same slug.
  // The generated column participates in constraints normally.
  pgm.addConstraint(
    "permissions",
    "uq_permissions_tenant_slug",
    "UNIQUE (tenant_id, slug)",
  );

  pgm.createIndex("permissions", "tenant_id", { name: "idx_permissions_tenant_id" });

  // Slug index — PermissionResolver and PolicyRegistry both look up by slug.
  pgm.createIndex("permissions", ["tenant_id", "slug"], {
    name: "idx_permissions_tenant_slug",
  });

  pgm.sql(`
    CREATE TRIGGER trg_permissions_updated_at
    BEFORE UPDATE ON permissions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);


  // ---------------------------------------------------------------------------
  // role_permissions  (junction)
  // ---------------------------------------------------------------------------
  pgm.createTable("role_permissions", {
    role_id: {
      type: "text",
      notNull: true,
      references: '"roles"',
      onDelete: "CASCADE",
    },

    permission_id: {
      type: "text",
      notNull: true,
      references: '"permissions"',
      onDelete: "CASCADE",
    },

    // No created_at/updated_at — junctions are assigned or revoked, not updated.
    // The assignment timestamp is not a first-class audit concern here;
    // the audit_log captures the effective result at evaluation time.
    assigned_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint(
    "role_permissions",
    "pk_role_permissions",
    "PRIMARY KEY (role_id, permission_id)",
  );

  // Lookup path: given a role, find all its permissions.
  pgm.createIndex("role_permissions", "role_id", {
    name: "idx_role_permissions_role_id",
  });

  // Reverse lookup: given a permission, find all roles that hold it.
  // Used by the unassigned-permission hygiene endpoint (AD-T-06, Day 23).
  pgm.createIndex("role_permissions", "permission_id", {
    name: "idx_role_permissions_permission_id",
  });


  // ---------------------------------------------------------------------------
  // principal_roles  (junction)
  // ---------------------------------------------------------------------------
  pgm.createTable("principal_roles", {
    principal_id: {
      type: "text",
      notNull: true,
      references: '"principals"',
      onDelete: "CASCADE",
    },

    role_id: {
      type: "text",
      notNull: true,
      references: '"roles"',
      onDelete: "CASCADE",
    },

    assigned_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.addConstraint(
    "principal_roles",
    "pk_principal_roles",
    "PRIMARY KEY (principal_id, role_id)",
  );

  // Primary lookup path: given a principal, find all their roles.
  // This is the starting point for permission flattening (Day 7).
  pgm.createIndex("principal_roles", "principal_id", {
    name: "idx_principal_roles_principal_id",
  });

  pgm.createIndex("principal_roles", "role_id", {
    name: "idx_principal_roles_role_id",
  });


  // ---------------------------------------------------------------------------
  // policies
  // ---------------------------------------------------------------------------
  pgm.createTable("policies", {
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

    // The full policy language lives here (AD-C-01, AD-A-04):
    //   An array of permission slugs the principal must hold.
    //   Example: ["billing:read", "billing:read:restricted"]
    //
    // Validated at write time by PolicyRegistry (AD-C-02).
    // At evaluation time, the evaluator receives this array as-is.
    // Slugs referencing deleted permissions are treated as unsatisfied (AD-C-04).
    required_permissions: {
      type: "jsonb",
      notNull: true,
    },

    // ANY: allow if the principal holds at least one required permission.
    // ALL: allow only if the principal holds every required permission.
    match_strategy: {
      type: "text",
      notNull: true,
      check: "match_strategy IN ('ANY', 'ALL')",
    },

    // Bound at write time. Mismatch at evaluation = hard rejection (AD-C-03).
    // Makes context schema migrations planned operational events, not silent upgrades.
    context_version: {
      type: "text",
      notNull: true,
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

  // Policy names unique within a tenant.
  pgm.addConstraint(
    "policies",
    "uq_policies_tenant_name",
    "UNIQUE (tenant_id, name)",
  );

  pgm.createIndex("policies", "tenant_id", { name: "idx_policies_tenant_id" });

  pgm.sql(`
    CREATE TRIGGER trg_policies_updated_at
    BEFORE UPDATE ON policies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
}


/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export async function down(pgm) {
  // Triggers first
  pgm.sql("DROP TRIGGER IF EXISTS trg_policies_updated_at    ON policies;");
  pgm.sql("DROP TRIGGER IF EXISTS trg_permissions_updated_at ON permissions;");
  pgm.sql("DROP TRIGGER IF EXISTS trg_roles_updated_at       ON roles;");

  // Junctions before the tables they reference
  pgm.dropTable("principal_roles",  { ifExists: true });
  pgm.dropTable("role_permissions",  { ifExists: true });

  // Policies before permissions/roles (no FK dependency, but logical order)
  pgm.dropTable("policies",          { ifExists: true });
  pgm.dropTable("permissions",       { ifExists: true });
  pgm.dropTable("roles",             { ifExists: true });
}