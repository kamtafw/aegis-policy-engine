// typed pipeline context contracts (AD-A-02)
//
// these types are the domain language of enforcement; every stage boundary in the
// EnforcementPipeline is a typed handoff between these objects; no stage leaks raw
// transport structures, ORM entities, or cache payloads into this domain.
//
// all types are structurally immutable (readonly properties); they live here and nowhere else
//
// handoff sequence:
//   HttpAdapter            → EnforcementPipeline  : RouteContext + RawToken (parallel)
//   EnforcementPipeline    → IdentityService       : RouteContext + RawToken
//   IdentityService        → EnforcementPipeline   : IdentityContext (RawToken discarded)
//   EnforcementPipeline    → PermissionResolver     : IdentityContext
//   PermissionResolver     → EnforcementPipeline    : PermissionContext
//   EnforcementPipeline    → PolicyEngine           : Policy + PermissionContext.permissions
//   PolicyEngine           → EnforcementPipeline    : Decision
//   EnforcementPipeline    → AuditPort              : AuditRecord (assembled here — only component with all 4 contexts)

import type {
	TenantId,
	PrincipalId,
	RouteId,
	PolicyId,
	ActionSlug,
	ResourceSlug,
	PermissionSlug,
} from "@domain/ids"

// ----------------------------------------------------------------------------
// RouteContext
// produced by: HttpAdapter
// consumed by: EnforcementPipeline (passed alongside RawToken as parallel param)
//
// contains only the route-level facts needed to drive the pipeline
// the rawToken is a PARALLEL PARAMETER — it is never embedded here (AD-C-06).
// ----------------------------------------------------------------------------
export interface RouteContext {
	readonly routeId: RouteId
	readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"
	readonly action: ActionSlug /** action this route performs — drawn from a closed vocabulary (AD-T-02) */
	readonly resourceType: ResourceSlug /** resource type this route operates on */
	/**
	 * tenant-safe headers only — no Authorization header, no raw JWT
	 * the HttpAdapter strips sensitive headers before populating this field
	 */
	readonly requestMetadata: Readonly<Record<string, string>>
}

// ----------------------------------------------------------------------------
// IdentityContext
// produced by: IdentityService (after JWT is validated and discarded)
// consumed by: PermissionResolver
//
// the rawToken does not appear here; it never returns from IdentityService
// ----------------------------------------------------------------------------
export interface IdentityContext {
	readonly tenantId: TenantId
	readonly principalId: PrincipalId
	readonly keyVersion: number /** key version used for signature verification — for cache key construction */
	readonly principalVersion: number /** incremented by AccessControl on role/permission changes */
}

// ----------------------------------------------------------------------------
// PermissionContext
// produced by: PermissionResolver
// consumed by: PolicyEngine (permissions field) + EnforcementPipeline (for AuditRecord)
//
// the flat permission set — no role graph, no hierarchy; pre-flattened by AccessControl
// ----------------------------------------------------------------------------
export interface PermissionContext {
	readonly tenantId: TenantId
	readonly principalId: PrincipalId
	readonly permissions: ReadonlySet<PermissionSlug> /** flat set of all permissions held by this principal across all their roles */
	readonly policyVersion: number /** the policy version this projection was computed against */
	readonly principalVersion: number
}

// ----------------------------------------------------------------------------
// Decision
// produced by: PolicyEngine
// consumed by: EnforcementPipeline (for HTTP response + AuditRecord assembly)
//
// PolicyEngine is a pure function — Decision is its only output
// ----------------------------------------------------------------------------
export interface Decision {
	readonly allowed: boolean
	/**
	 * human-readable reason naming the deciding permission slug
	 * for ALLOW with ANY: the first permission that satisfied the policy
	 * for DENY with ALL: the first permission that was not held
	 * for DENY with ANY: indicates no required permissions were held
	 * must be self-explanatory to a security engineer who did not build the system (AD-T-04)
	 */
	readonly reason: string
	readonly evaluatedPolicyVersion: number
	readonly evaluatedPrincipalVersion: number
}

// ----------------------------------------------------------------------------
// AuditRecord
// produced by: EnforcementPipeline only
// consumed by: AuditPort
//
// EnforcementPipeline is the only component that holds all four context objects
// simultaneously — therefore it is the only correct assembly point for this type
// this is not a convention; it is a structural consequence of the pipeline design
// ----------------------------------------------------------------------------
export interface AuditRecord {
	readonly tenantId: TenantId
	readonly principalId: PrincipalId
	readonly routeId: RouteId
	readonly policyId: PolicyId
	readonly action: ActionSlug
	readonly decision: Decision
	readonly timestamp: Date
}
