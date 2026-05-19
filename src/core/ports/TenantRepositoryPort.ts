// repository port for tenant persistence; consumed by:
//   - TenantRegistryService
//   - AccessControlService  (incrementPolicyVersion on authz model changes)
//   - PolicyRegistryService (incrementPolicyVersion on policy changes)
//
// implemented by: adapters/postgres/TenantRepository.ts
//
// only the methods actually called by core services are on this interface
// TenantRepository may have additional methods (findBySlug etc.) used by
// route handlers directly — those are adapter details, not port concerns
//
// plane: core/ports

import type { PlanTier, Tenant, TenantId } from "@core/domain"

export interface CreateTenantInput {
	id: TenantId
	slug: string
	name: string
	publicKey: string
	planTier: PlanTier
}

export interface TenantRepositoryPort{
  create(input:CreateTenantInput): Promise<Tenant>
  findById(id:TenantId): Promise<Tenant|null>

  /** increments key_version; returns the new value; called on key rotation (AD-P-07) */
  incrementKeyVersion(id:TenantId): Promise<number>

  /**
   * increments policy_version; returns the new value;
   * called by AccessControlService and PolicyRegistryService on any
   * authz model change to invalidate the decision cache (AD-P-07)
   */
  incrementPolicyVersion(id: TenantId): Promise<number>
}
