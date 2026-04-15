// fetches the policy attached to a route; consumed by:
//   - EnforcementPipeline (after route resolution, before PolicyEngine)
//
// implemented by: adapters/postgres/PolicyRepositoryAdapter.ts
//
// all queries are tenant-scoped — tenant_id is non-optional (AD-S-01).
// the gateway never receives a policy that wasn't already validated at write time (AD-C-02).
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
