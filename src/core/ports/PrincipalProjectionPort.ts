// the read side of the CQRS-lite split (AD-C-07)
// fetches the precomputed, flattened permission set for a principal; consumed by:
//   - PermissionResolver (on cache miss, as the DB fallback path)
//
// implemented by: adapters/postgres/PrincipalProjectionAdapter.ts
//
// WHY THIS RETURNS PermissionProjection AND NOT PermissionContext:
//   the Day 12 spec shorthand says getPermissions() → PermissionContext;
//   that describes the end result of calling PermissionResolver, not this port
//
//   this port fetches data from storage; PermissionResolver constructs
//   PermissionContext from that data by adding the tenantId and principalId
//   it already has from IdentityContext; the port does not need to construct
//   domain context objects — it just returns what it found
//
//   PermissionResolver flow on cache miss:
//     1. Call getPermissions(principalId, tenantId) → PermissionProjection
//     2. Construct PermissionContext from projection + IdentityContext fields
//     3. Write PermissionContext back to cache
//     4. Return PermissionContext to EnforcementPipeline
//
// WHY THE PROJECTION IS FLAT (AD-P-03):
//   this port returns a flat Set<PermissionSlug> — not a list of roles, not
//   a role graph; the role graph was traversed by AccessControl (write model)
//   when it saved the projection to the database; PermissionResolver never
//   traverses roles at request time; the flat set is the contract boundary
//   between the management plane and the runtime plane
//
// TENANT ISOLATION (AD-S-01):
//   both principal_id and tenant_id are required; a principal in Tenant A
//   cannot be resolved in the context of Tenant B — the query is structurally
//   scoped to prevent cross-tenant projection reads
//
// NULL SEMANTICS:
//   returns null if the principal does not exist within the given tenant;
//   PermissionResolver treats null as deny (AD-S-07)
//
// plane: core/ports — no infrastructure imports here; ever

import type { TenantId, PrincipalId, PermissionSlug } from "@domain/ids"

/**
 * the read projection of a principal's permissions
 * version-stamped so PermissionResolver can detect stale projections
 */
export interface PermissionProjection {
	principalId: PrincipalId
	tenantId: TenantId
	permissions: Set<PermissionSlug> /** flat set — no role graph, no hierarchy, no traversal needed at request time */
	principalVersion: number /** incremented by AccessControl on any role/permission assignment change */
	policyVersion: number /** incremented by AccessControl on any policy/role/permission change for this tenant */
}

export interface PrincipalProjectionPort {
	/**
	 * fetch the flat permission projection for a principal
	 *
	 * returns null if the principal does not exist within the tenant
	 * a null projection causes PermissionResolver to deny — AD-S-07
	 *
	 * tenant_id is non-optional; the query is structurally prevented from
	 * crossing tenant boundaries (AD-S-01)
	 */
	getPermissions(principalId: PrincipalId, tenantId: TenantId): Promise<PermissionProjection | null>
}
