// AccessControlService — write model for the authorization domain.
//
// responsibilities in this file (Day 5):
//   - Principal creation and listing
//
// responsibilities added later:
//   - Role CRUD (Day 6)
//   - Permission CRUD (Day 6)
//   - Role/permission assignment (Day 6)
//   - policy_version + principal_version counter increments (Day 6)
//   - Decision cache invalidation on version bump (Day 6)
//   - Role graph flattening → permission projection (Day 7)
//
// this service is the write model; the read model (flat permission projection)
// lives in PermissionResolver in the Runtime plane (CQRS-lite, AD-C-07)
// these two never call each other — they communicate only through the database
//
// plane: core/management

import type { Principal, PrincipalId, TenantId } from "@core/domain"
import type {
	PrincipalRepository,
	CreatePrincipalInput,
} from "../../../adapters/postgres/PrincipalRepository"

export interface CreatePrincipalParams {
	externalId: string
	metadata?: Record<string, unknown>
}

export class AccessControlService {
	constructor(private readonly principalRepo: PrincipalRepository) {}

	async createPrincipal(tenantId: TenantId, params: CreatePrincipalParams): Promise<Principal> {
		const id = `pri_${crypto.randomUUID()}` as PrincipalId

		const input: CreatePrincipalInput = {
			id,
			externalId: params.externalId,
			metadata: params.metadata ?? {},
		}

		return this.principalRepo.create(tenantId, input)
	}

	// tenant_id required — no cross-tenant listing exists (AD-S-01).
	async listPrincipals(tenantId: TenantId): Promise<Principal[]> {
		return this.principalRepo.listByTenant(tenantId)
	}
}
