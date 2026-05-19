// repository port for policy persistence (management plane CRUD)
// consumed by: PolicyRegistryService
//
// implemented by: adapters/postgres/PolicyRepository.ts
//
// NOT to be confused with PolicyPort (src/core/ports/PolicyPort.ts)
// PolicyPort is the runtime port: fetches a policy by route for enforcement
// PolicyRepositoryPort is the management port: CRUD for the admin API
//
// all methods are tenant-scoped — tenant_id is non-optional (AD-S-01)
//
// plane: core/ports

import type { PolicyId, PermissionSlug, TenantId } from "@core/domain"
import type { Policy } from "./PolicyPort"

export interface CreatePolicyInput {
	id: PolicyId
	name: string
	requiredPermissions: PermissionSlug[]
	matchStrategy: "ANY" | "ALL"
	contextVersion: string
}

export interface PolicyRepositoryPort {
	create(tenantId: TenantId, input: CreatePolicyInput): Promise<Policy>
	findById(tenantId: TenantId, id: PolicyId): Promise<Policy | null>
	listByTenant(tenantId: TenantId): Promise<Policy[]>
}
