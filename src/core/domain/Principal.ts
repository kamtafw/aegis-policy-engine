// Principal — a user or service account that authenticates with Aegis
//
// principals exist within a tenant — there is no global principal
// the external_id is whatever the tenant uses as their user identifier
// (e.g. a UUID from their own auth system). Aegis does not own identity —
// it only maps external identities to authorization decisions
//
// principal_version increments whenever the principal's role assignments
// or metadata change; it is embedded in the decision cache key so that
// stale permission projections are never served after an update (AD-P-08)

import { TenantId, PrincipalId } from "./ids"

export interface Principal {
	readonly id: PrincipalId
	readonly tenantId: TenantId
	readonly externalId: string /** the caller's identifier in the tenant's own system — surfaced in JWT claims*/
	readonly metadata: Readonly<
		Record<string, unknown>
	> /** arbitrary tenant-defined metadata — not used in policy evaluation */
	readonly principalVersion: number /** incremented by AccessControl on role/permission assignment changes (AD-P-07) */
	readonly createdAt: Date
}
