// Migration 001 — Tenants & Principals
//
// Establishes the two foundational tables that everything else hangs off.
//
// TENANTS
//   Top-level isolation boundary. Every row in every other table belongs to
//   a tenant. Two independent version counters live here (AD-P-07):
//
//     key_version    — incremented on key rotation. Scopes the Redis JWT public key cache.
//                      Cache key: `tenant:{id}:key:{key_version}`
//
//     policy_version — incremented on any role/permission/policy change. Scopes the Redis decision cache.
//                      Cache key: `tenant:{id}:policy:{policy_version}:principal:{principal_id}:v:{principal_version}`
//
//   They increment independently. A key rotation MUST NOT flush the decision
//   cache. A policy change MUST NOT flush the key cache. (AD-P-07)
//
// PRINCIPALS
//   A user or service account within a tenant. The external_id is the tenant's own
//   identifier for the user — whatever appears as `sub` in their JWTs.
//   principal_version increments on any role assignment change so the decision
//   cache key goes stale correctly per-principal. (AD-P-08)
//
// TENANT ISOLATION (AD-S-01)
//   principals.tenant_id is a hard FK to tenants.id with ON DELETE CASCADE.
//   A principal cannot outlive its tenant. No orphaned rows are possible.
//
// AD refs: AD-S-01, AD-P-07, AD-P-08

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export async function up(pgm) {
	// ---------------------------------------------------------------------------
	// tenants
	// ---------------------------------------------------------------------------
	pgm.createTable("tenants", {
		// Application-generated IDs (prefixed ULIDs, e.g. "ten_01J...").
		// The database never generates IDs — application owns ID generation.
		id: {
			type: "text",
			primaryKey: true,
			notNull: true,
		},

		// Human-readable unique identifier used in URLs and audit records.
		// Lowercase alphanumeric + hyphens only. Immutable after creation —
		// changing a slug would create a gap in the audit trail.
		slug: {
			type: "text",
			notNull: true,
			unique: true,
			check: "slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'",
		},

		name: {
			type: "text",
			notNull: true,
		},

		// RSA public key in PEM format. Used for JWT signature verification (AD-S-04).
		// Stored as text — the DB does not parse or validate key material.
		// Validation happens in the adapter before write, and in IdentityService at read.
		public_key: {
			type: "text",
			notNull: true,
		},

		// Version counter scoping the Redis JWT public key cache (AD-P-07a).
		// Incremented by TenantRegistryService on every public key rotation.
		// Starts at 1 — 0 is never a valid live key_version, keeping
		// "no cached key" distinct from "cached key at version 0".
		key_version: {
			type: "integer",
			notNull: true,
			default: 1,
			check: "key_version >= 1",
		},

		// Version counter scoping the Redis decision cache (AD-P-07).
		// Incremented by AccessControl on any role/permission change, and by
		// PolicyRegistry on any policy change.
		// Independent from key_version — rotating a key does not invalidate decisions.
		policy_version: {
			type: "integer",
			notNull: true,
			default: 1,
			check: "policy_version >= 1",
		},

		// Controls feature access — not used in gateway enforcement decisions.
		plan_tier: {
			type: "text",
			notNull: true,
			default: "'free'",
			check: "plan_tier IN ('free', 'pro', 'enterprise')",
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
	})

	// Slug lookups happen at tenant registration and in admin APIs.
	pgm.createIndex("tenants", "slug", {
		name: "idx_tenants_slug",
		unique: true,
	})

	// ---------------------------------------------------------------------------
	// principals
	// ---------------------------------------------------------------------------
	pgm.createTable("principals", {
		id: {
			type: "text",
			primaryKey: true,
			notNull: true,
		},

		// Hard FK — no orphaned principals. If a tenant is deleted, all their
		// principals are deleted with them. (AD-S-01)
		tenant_id: {
			type: "text",
			notNull: true,
			references: '"tenants"',
			onDelete: "CASCADE",
		},

		// The principal's identifier in the tenant's own system.
		// Appears as `sub` in JWTs. Unique within a tenant — two tenants can have
		// a principal with the same external_id; they are independent records.
		external_id: {
			type: "text",
			notNull: true,
		},

		// Arbitrary tenant-defined data — not used in policy evaluation.
		// The evaluator never reads this field. Stored for admin/display use only.
		metadata: {
			type: "jsonb",
			notNull: true,
			default: pgm.func(`'{}'::jsonb`),
		},

		// Incremented by AccessControl on any role assignment change for this
		// principal. Combined with policy_version to form the decision cache key
		// so stale permissions are never served after an update. (AD-P-08)
		principal_version: {
			type: "integer",
			notNull: true,
			default: 1,
			check: "principal_version >= 1",
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
	})

	// external_id is unique per tenant, not globally.
	pgm.addConstraint(
		"principals",
		"uq_principals_tenant_external",
		"UNIQUE (tenant_id, external_id)",
	)

	// Every query against principals is tenant-scoped (AD-S-01).
	// This index is the structural backing for that requirement at the DB level.
	pgm.createIndex("principals", "tenant_id", {
		name: "idx_principals_tenant_id",
	})

	// ---------------------------------------------------------------------------
	// updated_at trigger
	//
	// Using pgm.sql() directly — avoids node-pg-migrate version-specific
	// differences in the createFunction/createTrigger API surface.
	// ---------------------------------------------------------------------------
	pgm.sql(`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$;
  `)

	pgm.sql(`
    CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `)

	pgm.sql(`
    CREATE TRIGGER trg_principals_updated_at
    BEFORE UPDATE ON principals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `)
}

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export async function down(pgm) {
	// Drop triggers before tables; function last — may be reused by later migrations.
	pgm.sql("DROP TRIGGER IF EXISTS trg_principals_updated_at ON principals;")
	pgm.sql("DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;")

	// principals first — it holds the FK reference to tenants.
	pgm.dropTable("principals", { ifExists: true })
	pgm.dropTable("tenants", { ifExists: true })

	// CASCADE handles any remaining dependencies.
	pgm.sql("DROP FUNCTION IF EXISTS set_updated_at() CASCADE;")
}
