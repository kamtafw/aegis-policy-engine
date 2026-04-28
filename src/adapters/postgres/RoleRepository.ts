// all queries are tenant-scoped; tenant_id is a non-optional parameter
// on every method — there is no "get all roles" query; (AD-S-01)

import type { Sql } from "./client"
import type { TenantId, RoleId, Role, PermissionId } from "@core/domain"

interface RoleRow {
	id: string
	tenantId: string
	name: string
	createdAt: Date
}

export interface CreateRoleInput {
	id: RoleId
	name: string
}

function rowToRole(row: RoleRow): Role {
	return {
		id: row.id as RoleId,
		tenantId: row.tenantId as TenantId,
		name: row.name,
		createdAt: row.createdAt,
	}
}

export class RoleRepository {
	constructor(private readonly sql: Sql) {}

	async create(tenantId: TenantId, input: CreateRoleInput): Promise<Role> {
		const [row] = await this.sql<RoleRow[]>`
      INSERT INTO roles (id, tenant_id, name)
      VALUES (${input.id}, ${tenantId}, ${input.name})
      RETURNING *
    `
		return rowToRole(row!)
	}

	async findById(tenantId: TenantId, id: RoleId): Promise<Role | null> {
		const [row] = await this.sql<RoleRow[]>`
      SELECT * FROM roles
      WHERE tenant_id = ${tenantId}
        AND id = ${id}
    `
		return row ? rowToRole(row) : null
	}

	async listByTenant(tenantId: TenantId): Promise<Role[]> {
		const rows = await this.sql<RoleRow[]>`
      SELECT * FROM roles
      WHERE tenant_id = ${tenantId}
      ORDER BY name ASC
    `
		return rows.map(rowToRole)
	}

	// idempotent — assigning the same permission twice is not an error;
	// ON CONFLICT DO NOTHING means the second call is a silent no-op;
	// the caller (AccessControlService) still increments policy_version even
	// on a no-op — that is correct: the intent to change was expressed
	async assignPermission(
		tenantId: TenantId,
		roleId: RoleId,
		permissionId: PermissionId,
	): Promise<void> {
		// verify the role belongs to this tenant before writing the junction row;
		// prevents cross-tenant assignment if a caller passes a mismatched pair
		const role = await this.findById(tenantId, roleId)
		if (!role) throw new Error(`Role not found: ${roleId} in tenant ${tenantId}`)

		await this.sql`
      INSERT INTO role_permissions (role_id, permission_id)
      VALUES (${roleId}, ${permissionId})
      ON CONFLICT DO NOTHING
    `
	}

	// returns all permission IDs assigned to a role within a tenant;
	// used by AccessControlService.flattenPermissions (Day 7)
	async getPermissionIds(tenantId: TenantId, roleId: RoleId): Promise<PermissionId[]> {
		const rows = await this.sql<{ permissionId: string }[]>`
      SELECT rp.permission_id
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      WHERE r.tenant_id = ${tenantId}
        AND rp.role_id  = ${roleId}
    `
		return rows.map((r) => r.permissionId as PermissionId)
	}
}
