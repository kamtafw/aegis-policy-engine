// repository adapter for the principals table.
//
// CRITICAL: tenant_id is a non-optional parameter on every method (AD-S-01)
// no method exists that returns principals without a tenant scope
// the query structure makes cross-tenant access structurally impossible —
// you cannot call these methods without providing a tenant_id.
//
// plane: adapters/postgres

import type { Sql } from "./client.js"
import type { Principal, TenantId, PrincipalId } from "@core/domain"

interface PrincipalRow {
	id: string
	tenantId: string
	externalId: string
	metadata: Record<string, unknown>
	principalVersion: number
	createdAt: Date
	updatedAt: Date
}

export interface CreatePrincipalInput {
	id: PrincipalId
	externalId: string
	metadata: Record<string, unknown>
}

function rowToPrincipal(row: PrincipalRow): Principal {
	return {
		id: row.id as PrincipalId,
		tenantId: row.tenantId as TenantId,
		externalId: row.externalId,
		metadata: row.metadata,
		principalVersion: row.principalVersion,
		createdAt: row.createdAt,
	}
}

export class PrincipalRepository {
	constructor(private readonly sql: Sql) {}

	// tenant_id is required — enforced structurally, not by convention (AD-S-01).
	async create(tenantId: TenantId, input: CreatePrincipalInput): Promise<Principal> {
		const [row] = await this.sql<PrincipalRow[]>`
      INSERT INTO principals (id, tenant_id, external_id, metadata)
      VALUES (
        ${input.id},
        ${tenantId},
        ${input.externalId},
        ${JSON.stringify(input.metadata)}::jsonb
      )
      RETURNING *
    `
		return rowToPrincipal(row!)
	}

	// tenant_id required — no "list all principals" query exists (AD-S-01).
	async listByTenant(tenantId: TenantId): Promise<Principal[]> {
		const rows = await this.sql<PrincipalRow[]>`
      SELECT * FROM principals
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at ASC
    `
		return rows.map(rowToPrincipal)
	}

	// both tenant_id and principal_id required — prevents cross-tenant principal lookup.
	async findById(tenantId: TenantId, id: PrincipalId): Promise<Principal | null> {
		const [row] = await this.sql<PrincipalRow[]>`
      SELECT * FROM principals
      WHERE tenant_id = ${tenantId}
        AND id = ${id}
    `
		return row ? rowToPrincipal(row) : null
	}

	// called by AccessControlService on any role assignment change (AD-P-08).
	// returns the new principal_version so the caller can invalidate the cache.
	async incrementVersion(tenantId: TenantId, id: PrincipalId): Promise<number> {
		const [row] = await this.sql<{ principalVersion: number }[]>`
      UPDATE principals
      SET principal_version = principal_version + 1
      WHERE tenant_id = ${tenantId}
        AND id = ${id}
      RETURNING principal_version
    `
		if (!row) throw new Error(`Principal not found: ${id} in tenant ${tenantId}`)
		return row.principalVersion
	}
}
