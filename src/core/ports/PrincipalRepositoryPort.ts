// repository port for principal persistence; consumed by:
//    - AccessControlService
//
// implemented by: adapters/postgres/PrincipalRepository.ts
//
// all methods are tenant-scoped  tenant_id is non-optional (AD-S-01)
// 
// NOTE ON JWT sub CLAIM:
//   IdentityService calls findById(tenantId, principalId) where principalId
//   comes from the JWT `sub` claim. This means the JWT issuer must mint tokens
//   with the Aegis internal principalId (e.g. "pri_xxx") in `sub`.
//   The externalId field on Principal is for admin display and external system
//   correlation — it does not appear in `sub`.
//
// plane: core/ports

import { Principal, PrincipalId, RoleId, TenantId } from "@core/domain"

export interface CreatePrincipalInput {
	id: PrincipalId
	externalId: string
	metadata: Record<string, unknown>
}

export interface PrincipalRepositoryPort {
	create(tenantId: TenantId, input: CreatePrincipalInput): Promise<Principal>
	findById(tenantId: TenantId, id: PrincipalId): Promise<Principal | null>
	listByTenant(tenantId: TenantId): Promise<Principal[]>

  /** assigns a role to a principal via the principal_roles junction */
  assignRole(tenantId:TenantId, principalId:PrincipalId, roleId:RoleId):Promise<void>

  /**
   * increments principal_version; returns the new value
   * called by AccessControlService on any role assignment change (AD-P-08)
   */
  incrementVersion(tenantId:TenantId, id:PrincipalId): Promise<number>
}
