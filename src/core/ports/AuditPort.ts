// the audit intake abstraction; consumed by:
//   - EnforcementPipeline (writes AuditRecord synchronously before dispatching response)
//
// implemented by: adapters/redis/RedisAuditBufferAdapter.ts
//
// CRITICAL SEMANTICS (AD-S-08):
//   implementations of this port MUST throw on write failure
//   they MUST NOT swallow errors or return silently when the write fails.
//
//   the contract is: if record() returns (doesn't throw), the record is durably
//   buffered; if record() throws, EnforcementPipeline catches it and denies
//   the request — fail closed
//
//   "Fire and forget" is explicitly forbidden; silent audit loss is a security
//   failure, not an availability tradeoff
//
// plane: core/ports — no infrastructure imports here; ever

import type { TenantId, PrincipalId, RouteId, ActionSlug, PolicyId } from "@domain/ids"

/**
 * the decision record written to the audit buffer for every gateway request
 * assembled by EnforcementPipeline — the only component with all four context objects
 */
export interface AuditRecord {
	tenantId: TenantId
	principalId: PrincipalId
	routeId: RouteId
	action: ActionSlug /** the action slug from RouteContext — what the principal attempted */
	policyId: PolicyId
	allowed: boolean /** whether the request was allowed or denied */
	reason: string /** human-readable reason from PolicyEngine — names the deciding permission slug */
	evaluatedPolicyVersion: number /** the policy version active at evaluation time — for forensic audit (AD-S-08) */
	evaluatedPrincipalVersion: number /** the principal version active at evaluation time */
	timestamp: Date
}

export interface AuditPort {
	/**
	 * write a decision record to the durable audit buffer
	 *
	 * MUST throw if the write fails for any reason:
	 *  - buffer unavailable
	 *  - buffer full
	 *  - network error
	 *  - any other infrastructure failure
	 *
	 * MUST NOT return silently on failure
	 * MUST NOT swallow errors
	 *
	 * callers (EnforcementPipeline) rely on throw semantics to trigger fail-closed
	 * behaviour — an uncaught throw here becomes a request denial (AD-S-08)
	 *
	 * if this method returns without throwing, the caller may assume the record
	 * is durably buffered and will eventually reach the persistent audit log
	 */
	record(auditRecord: AuditRecord): Promise<void>
}
