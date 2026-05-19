// the audit intake abstraction; consumed by:
//   - EnforcementPipeline (writes AuditRecord synchronously before dispatching response)
//
// implemented by: adapters/redis/RedisAuditBufferAdapter.ts
//
// WHY AUDIT WRITE IS SYNCHRONOUS AND FAIL-CLOSED (AD-S-08):
//   the audit record is not observability infrastructure — it is a security
//   requirement; every gateway decision, allow and deny, must be durably
//   recorded before the response is dispatched
//
//   "Fire and forget" is explicitly forbidden; if the audit write fails and
//   the request was allowed, there is no record that access occurred; that
//   is a security failure, not an availability tradeoff
//
//   the write path uses a fast Redis stream buffer (not Postgres directly),
//   so the latency cost is minimal; AuditDrainWorker (Day 17) drains the
//   buffer to Postgres asynchronously; but from EnforcementPipeline's
//   perspective: write to buffer → it throws → deny; no exceptions
//
// AUDITRECORD SOURCE:
//   AuditRecord is defined in core/runtime/context/ — the canonical location
//   for all pipeline types; it is re-exported here so consumers of this port
//   can import AuditRecord from one place
//
//   the record uses a nested Decision field rather than flat allow/reason fields;
//   this groups the evaluation result with the version snapshot that produced it
//
// plane: core/ports — no infrastructure imports here; ever

export type { AuditRecord } from "@core/runtime/context"
import type { AuditRecord } from "@core/runtime/context"

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
