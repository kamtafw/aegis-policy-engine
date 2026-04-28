// repository adapter for the tenants table
//
// all methods return domain types (Tenant), never raw DB rows;
// the postgres.js `transform: camel` option on the client handles
// snake_case → camelCase conversion, so row shapes match domain types directly
//
// this adapter is instantiated in server.ts and injected into TenantRegistryService;
// Core never imports this file — it is wired at the composition root only
//
// plane: adapters/postgres

import { Sql } from "./client"
import type { TenantId, Tenant, PlanTier } from "@core/domain"

// shape of a row coming back from the tenants table after camelCase transform;
// matches the Tenant domain type closely — only Date needs a cast since
// postgres.js returns timestamptz as Date objects natively
interface TenantRow {
	id: string
	slug: string
	name: string
	publicKey: string
	keyVersion: number
	policyVersion: number
	planTier: string
	createdAt: Date
	updatedAt: Date
}

export interface CreateTenantInput {
	id: TenantId
	slug: string
	name: string
	publicKey: string
	planTier: PlanTier
}

function rowToTenant(row: TenantRow): Tenant {
	return {
		id: row.id as TenantId,
		slug: row.slug,
		name: row.name,
		publicKey: row.publicKey,
		keyVersion: row.keyVersion,
		policyVersion: row.policyVersion,
		planTier: row.planTier as PlanTier,
		createdAt: row.createdAt,
	}
}

export class TenantRepository {
	constructor(private readonly sql: Sql) {}

	async create(input: CreateTenantInput): Promise<Tenant> {
		const [row] = await this.sql<TenantRow[]>`
      INSERT INTO tenants (id, slug, name, public_key, plan_tier)
      VALUES (
        ${input.id},
        ${input.slug},
        ${input.name},
        ${input.publicKey},
        ${input.planTier}
      )
      RETURNING *
    `

		// non-null assertion is safe: INSERT ... RETURNING always returns the row
		// or throws — it never returns an empty array.
		return rowToTenant(row!)
	}

	// used by IdentityService to resolve tenant from JWT claims (Day 13).
	// tenant_id is the PK — no additional scope needed.
	async findById(id: TenantId): Promise<Tenant | null> {
		const [row] = await this.sql<TenantRow[]>`
      SELECT * FROM tenants
      WHERE id = ${id}
    `
		return row ? rowToTenant(row) : null
	}

	async findBySlug(slug: string): Promise<Tenant | null> {
		const [row] = await this.sql<TenantRow[]>`
      SELECT * FROM tenants
      WHERE slug = ${slug}
    `
		return row ? rowToTenant(row) : null
	}

	// called by TenantRegistryService on key rotation (Day 19).
	// returns the new key_version so the caller can invalidate the cache.
	async incrementKeyVersion(id: TenantId): Promise<number> {
		const [row] = await this.sql<{ keyVersion: number }[]>`
      UPDATE tenants
      SET key_version = key_version + 1
      WHERE id = ${id}
      RETURNING key_version
    `
		if (!row) throw new Error(`Tenant not found: ${id}`)
		return row.keyVersion
	}

	// called by AccessControl and PolicyRegistry on any authz model change (AD-P-07).
	// returns the new policy_version.
	async incrementPolicyVersion(id: TenantId): Promise<number> {
		const [row] = await this.sql<{ policyVersion: number }[]>`
      UPDATE tenants
      SET policy_version = policy_version + 1
      WHERE id = ${id}
      RETURNING policy_version
    `
		if (!row) throw new Error(`Tenant not found: ${id}`)
		return row.policyVersion
	}
}
