// all queries are tenant-scoped (AD-S-01)
//
// SLUG COLUMN: never written by the application;
// it is a GENERATED ALWAYS AS STORED column in Postgres (migration 002);
// INSERT provides only resource, action, specificity — the DB derives slug;
// attempting to INSERT slug directly will produce a Postgres error

import type { Sql } from "./client"
import type { TenantId, PermissionId, PermissionSlug, Permission, ValidAction } from "@core/domain"

interface PermissionRow {
	id: string
	tenantId: string
	resource: string
	action: string
	specificity: string | null
	slug: string
	createdAt: Date
}

export interface CreatePermissionInput {
	id: PermissionId
	resource: string
	action: ValidAction
	specificity: string | null
}

function rowToPermission(row: PermissionRow): Permission {
	return {
		id: row.id as PermissionId,
		tenantId: row.tenantId as TenantId,
		resource: row.resource,
		action: row.action as ValidAction,
		specificity: row.specificity,
		slug: row.slug as PermissionSlug,
	}
}

export class PermissionRepository {
	constructor(private readonly sql: Sql) {}

	async create(tenantId: TenantId, input: CreatePermissionInput): Promise<Permission> {
		// slug is omitted from the INSERT — Postgres computes it automatically.
		const [row] = await this.sql<PermissionRow[]>`
      INSERT INTO permissions (id, tenant_id, resource, action, specificity)
      VALUES (
        ${input.id},
        ${tenantId},
        ${input.resource},
        ${input.action},
        ${input.specificity}
      )
      RETURNING *
    `
		return rowToPermission(row!)
	}

	async findById(tenantId: TenantId, id: PermissionId): Promise<Permission | null> {
		const [row] = await this.sql<PermissionRow[]>`
      SELECT * FROM permissions
      WHERE tenant_id = ${tenantId}
        AND id        = ${id}
    `
		return row ? rowToPermission(row) : null
	}

	async findBySlug(tenantId: TenantId, slug: PermissionSlug): Promise<Permission | null> {
		const [row] = await this.sql<PermissionRow[]>`
      SELECT * FROM permissions
      WHERE tenant_id = ${tenantId}
        AND slug      = ${slug}
    `
		return row ? rowToPermission(row) : null
	}

	async listByTenant(tenantId: TenantId): Promise<Permission[]> {
		const rows = await this.sql<PermissionRow[]>`
      SELECT * FROM permissions
      WHERE tenant_id = ${tenantId}
      ORDER BY slug ASC
    `
		return rows.map(rowToPermission)
	}

	// bulk-fetch by IDs — used by flattenPermissions (Day 7) to resolve
	// permission IDs from role_permissions into full Permission objects;
	// all IDs must belong to the given tenant — the WHERE clause enforces this
	async findManyByIds(tenantId: TenantId, ids: PermissionId[]): Promise<Permission[]> {
		if (ids.length === 0) return []

		const rows = await this.sql<PermissionRow[]>`
      SELECT * FROM permissions
      WHERE tenant_id = ${tenantId}
        AND id = ANY(${this.sql.array(ids)})
    `
		return rows.map(rowToPermission)
	}
}
