// TenantRegistryService — owns tenant lifecycle.
//
// responsibilities in this file (Day 5):
//   - ID generation
//   - Delegating to the repository adapter
//
// responsibilities added later:
//   - Key cache invalidation on rotation (Day 19)
//   - Key rotation endpoint (Day 19)
//
// this service lives in the Management plane; it never imports from Runtime
// it receives a TenantRepository (adapter) via constructor injection
// the adapter is wired in server.ts — this file never imports from adapters/
//
// plane: core/management

import type { TenantId, Tenant, PlanTier } from "@core/domain"
import type {
	TenantRepository,
	CreateTenantInput,
} from "../../../adapters/postgres/TenantRepository"

// what the route handler passes in — validated by Zod at the HTTP boundary.
export interface CreateTenantParams {
	slug: string
	name: string
	publicKey: string
	planTier?: PlanTier
}

export class TenantRegistryService {
	constructor(private readonly tenantRepo: TenantRepository) {}

	async createTenant(params: CreateTenantParams): Promise<Tenant> {
		const id = `ten_${crypto.randomUUID()}` as TenantId

		const input: CreateTenantInput = {
			id,
			slug: params.slug,
			name: params.name,
			publicKey: params.publicKey,
			planTier: params.planTier ?? "free",
		}

		return this.tenantRepo.create(input)
	}

	async getTenantById(id: TenantId): Promise<Tenant | null> {
		return this.tenantRepo.findById(id)
	}
}
