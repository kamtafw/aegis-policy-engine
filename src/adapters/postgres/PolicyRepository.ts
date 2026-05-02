// repository adapter for the policies table.
// all queries are tenant-scoped — tenant_id is non-optional (AD-S-01)
//
// required_permissions is stored as JSONB (a string array);
// postgres.js returns JSONB columns as parsed JS values, so no manual
// JSON.parse() is needed — the value arrives as string[] directly
//
// plane: adapters/postgres

import type { Sql } from "./client"
import type { Policy } from "@core/ports"
import type { TenantId, PolicyId, PermissionSlug } from "@core/domain"

interface PolicyRow {
	id: string
	tenantId: string
	name: string
	requiredPermissions: string[] // postgres.js parses JSONB → string[]
	matchStrategy: string
	contextVersion: string
	createdAt: Date
	updatedAt: Date
}

function rowToPolicy(row: PolicyRow): Policy {
	return {
		id: row.id as PolicyId,
		tenantId: row.tenantId as TenantId,
		name: row.name,
		requiredPermissions: row.requiredPermissions as PermissionSlug[],
		matchStrategy: row.matchStrategy as "ANY" | "ALL",
		contextVersion: row.contextVersion,
	}
}

export interface CreatePolicyInput {
	id: PolicyId
	name: string
	requiredPermissions: PermissionSlug[]
	matchStrategy: "ANY" | "ALL"
	contextVersion: string
}

export class PolicyRepository {
	constructor(private readonly sql: Sql) {}

	async create(tenantId: TenantId, input: CreatePolicyInput): Promise<Policy> {
		const [row] = await this.sql<PolicyRow[]>`
      INSERT INTO policies (
        id,
        tenant_id,
        name,
        required_permissions,
        match_strategy,
        context_version
      )
      VALUES (
        ${input.id},
        ${tenantId},
        ${input.name},
        ${this.sql.json(input.requiredPermissions)},
        ${input.matchStrategy},
        ${input.contextVersion}
      )
      RETURNING *
    `
		return rowToPolicy(row!)
	}

	async listByTenant(tenantId: TenantId): Promise<Policy[]> {
		const rows = await this.sql<PolicyRow[]>`
      SELECT * FROM policies
      WHERE  tenant_id = ${tenantId}
      ORDER  BY created_at ASC
    `
		return rows.map(rowToPolicy)
	}

	async findById(tenantId: TenantId, id: PolicyId): Promise<Policy | null> {
		const [row] = await this.sql<PolicyRow[]>`
      SELECT * FROM policies
      WHERE  tenant_id = ${tenantId}
        AND  id        = ${id}
    `
		return row ? rowToPolicy(row) : null
	}
}
