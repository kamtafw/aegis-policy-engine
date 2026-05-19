// repository port for role persistence and role-permission assignments
// consumed by: AccessControlService
//
// implemented by: adapters/postgres/RoleRepository.ts
//
// all methods are tenant-scoped — tenant_id is non-optional (AD-S-01)
//
// plane: core/ports

import type { RoleId, TenantId, PermissionId, PrincipalId, PermissionSlug } from "@core/domain"

export interface Role {
	id: RoleId
	tenantId: TenantId
	name: string
	createdAt: Date
}

export interface CreateRoleInput {
	id: RoleId
	name: string
}

export interface RoleRepositoryPort {
	create(tenantId: TenantId, input: CreateRoleInput): Promise<Role>
	findById(tenantId: TenantId, id: RoleId): Promise<Role | null>
	listByTenant(tenantId: TenantId): Promise<Role[]>

	/** assigns a permission to a role via the role_permissions junction */
	assignPermission(tenantId: TenantId, roleId: RoleId, permissionId: PermissionId): Promise<void>

	/**
	 * traverses principal → roles → permissions in a single query
	 * returns the flat set of permission slugs — no role graph exposed (AD-P-03)
	 */
	getFlatPermissionSlugs(tenantId: TenantId, principalId: PrincipalId): Promise<PermissionSlug[]>
}
