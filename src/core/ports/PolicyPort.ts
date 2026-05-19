// fetches the policy attached to a route; consumed by:
//   - EnforcementPipeline (after route resolution, before PolicyEngine)
//
// implemented by: adapters/postgres/PolicyRepositoryAdapter.ts
//
// WHY THIS EXISTS AS A PORT:
//   EnforcementPipeline needs to fetch a Policy by route ID and tenant ID;
//   it should not know whether that comes from Postgres, a cache, or anywhere
//   else; PolicyPort is the contract — EnforcementPipeline depends on the
//   interface, not the implementation
//
//   this is also the port that makes EnforcementPipeline unit-testable:
//   in pipeline tests (Day 16), PolicyPort is mocked to return controlled
//   policy objects without a real database
//
// TENANT ISOLATION (AD-S-01):
//   tenant_id is non-optional; there is no "get policy by route ID" without
//   a tenant; the query is structurally scoped — cross-tenant policy access
//   is impossible from this interface
//
// NULL SEMANTICS:
//   returns null if no policy is attached to this route;
//   EnforcementPipeline treats null as deny — no policy means no access (AD-S-07);
//   this is intentional: a route without a policy is fail-closed by default
//
// VALIDATION GUARANTEE (AD-C-02):
//   Policies stored in the database were validated at write time by
//   PolicyRegistryService; The gateway never encounters a malformed policy;
//   this port does not re-validate — it trusts the write-time guarantee
//
// plane: core/ports — no infrastructure imports here; ever

import type { TenantId, RouteId, PolicyId, PermissionSlug } from "@domain/ids"

/**
 * the policy domain type — Option A: pure permission set + match strategy (AD-A-04)
 *
 * No conditions. No attribute evaluation. No rule groups.
 * all access differentiation is expressed through the permission taxonomy
 */
export interface Policy {
	id: PolicyId
	tenantId: TenantId
	name: string
	contextVersion: string /** bound at write time — mismatch causes hard rejection (AD-C-03) */
	matchStrategy:
		| "ANY"
		| "ALL" /** ANY: pass if any permission is held. ALL: pass if all permissions are held. */
	requiredPermissions: PermissionSlug[] /** pre-validated slugs — resource:action[:specificity] (AD-T-01) */
}

export interface PolicyPort {
	/**
	 * fetch the policy attached to the given route for the given tenant
	 *
	 * returns null if no policy is attached to this route
	 * a null policy causes EnforcementPipeline to deny — no policy = no access (AD-S-07)
	 *
	 * tenant_id is non-optional; no cross-tenant query is possible (AD-S-01)
	 */
	getPolicyForRoute(routeId: RouteId, tenantId: TenantId): Promise<Policy | null>
}
