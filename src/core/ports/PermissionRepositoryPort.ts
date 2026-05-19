// repository port for permission persistence; consumed by:
//   - AccessControlService
//
// implemented by: adapters/postgres/PermissionRepository.ts
//
// the slug column is GENERATED ALWAYS AS in the DB — the adapter never
// writes it; it is included on the return type because it is read back
// in RETURNING * and is the primary identifier used in policy evaluation
//
// all methods are tenant-scoped — tenant_id is non-optional (AD-S-01)
//
// plane: core/ports

import type { PermissionId, TenantId, ValidAction, PermissionSlug } from "@core/domain"

export interface Permission {
	id: PermissionId
	tenantId: TenantId
	resource: string
	action: ValidAction
	specificity: string | null
	slug: PermissionSlug
	createdAt: Date
}

export interface CreatePermissionInput {
	id: PermissionId
	resource: string
	action: ValidAction
	specificity: string | null
}

export interface PermissionRepositoryPort {
	create(tenantId: TenantId, input: CreatePermissionInput): Promise<Permission>
	findById(tenantId: TenantId, id: PermissionId): Promise<Permission | null>
	listByTenant(tenantId: TenantId): Promise<Permission[]>
}
