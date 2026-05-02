// PolicyRegistryService — manages policy definitions.
//
// KEY RESPONSIBILITIES (AD-C-01, AD-C-02, AD-C-03):
//
//   schema validation at write time (AD-C-02):
//     invalid policies are rejected before reaching this service — Zod
//     at the route boundary handles structural validation; this service
//     receives already-validated input and is responsible only for
//     domain-level concerns
//
//   context_version binding (AD-C-03):
//     the caller never supplies context_version; this service stamps it
//     at write time from CURRENT_CONTEXT_VERSION; mismatch at evaluation
//     time (Day 16) is a hard rejection — the evaluator never silently
//     evaluates a policy against the wrong context schema
//
//   policy_version increment (AD-P-07):
//     any change to the policy set invalidates the tenant's decision cache;
//     this service calls tenantRepo.incrementPolicyVersion() on every
//     create (and future update/delete)
//
// plane: core/management

import type { PolicyRepository } from "@adapters/postgres/PolicyRepository"
import type { TenantRepository } from "@adapters/postgres/TenantRepository"
import type { PermissionSlug, PolicyId, TenantId } from "@core/domain"
import type { Policy } from "@core/ports"

// the single context version in play for this deployment;
// when the evaluation context schema changes, this constant is incremented
// and a migration script updates all existing policies to the new version
// (AD-C-03 — context migrations are planned operational events, not silent upgrades)
export const CURRENT_CONTEXT_VERSION = "v1"

export interface CreatePolicyParams {
	name: string
	requiredPermissions: PermissionSlug[]
	matchStrategy: "ANY" | "ALL"
}

export class PolicyRegistryService {
	constructor(
		private readonly policyRepo: PolicyRepository,
		private readonly tenantRepo: TenantRepository,
	) {}

	async createPolicy(tenantId: TenantId, params: CreatePolicyParams): Promise<Policy> {
		const id = `pol_${crypto.randomUUID()}` as PolicyId

		const policy = await this.policyRepo.create(tenantId, {
			id,
			name: params.name,
			requiredPermissions: params.requiredPermissions,
			matchStrategy: params.matchStrategy,
			// context_version is never supplied by the caller — bound here (AD-C-03).
			contextVersion: CURRENT_CONTEXT_VERSION,
		})

		// creating a policy changes the authorization model — invalidate the
		// decision cache for all principals in this tenant (AD-P-07)
		await this.tenantRepo.incrementPolicyVersion(tenantId)

		return policy
	}

	async listPolicies(tenantId: TenantId): Promise<Policy[]> {
		return this.policyRepo.listByTenant(tenantId)
	}

	async getPolicyById(tenantId: TenantId, id: PolicyId): Promise<Policy | null> {
		return this.policyRepo.findById(tenantId, id)
	}
}
