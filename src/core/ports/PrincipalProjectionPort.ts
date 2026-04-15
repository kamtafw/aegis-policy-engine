// the read side of the CQRS-lite split (AD-C-07)
// fetches the precomputed, flattened permission set for a principal; consumed by:
//   - PermissionResolver (on cache miss, as the DB fallback path)
//
// implemented by: adapters/postgres/PrincipalProjectionAdapter.ts
//
// KEY DESIGN PRINCIPLE:
//   this port returns a flat Set<PermissionSlug> — the role graph has already
//   been traversed by AccessControl when it wrote the projection to the database.
//   PermissionResolver never traverses role hierarchy at request time (AD-P-03);
//   the flattened projection is the contract boundary between the Management and
//   Runtime planes
//
// all queries are tenant-scoped — tenant_id is non-optional (AD-S-01)
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
