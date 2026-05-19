// the JWT validation abstraction; consumed by:
//   - IdentityService (validates the RawToken, extracts claims)
//
// WHY THIS RETURNS JwtClaims AND NOT IdentityContext:
//   the Day 12 spec shorthand says validate() → IdentityContext; that
//   describes the end result of calling IdentityService, not this port
// 
//   this port does exactly one thing: validate a JWT and extract its claims;
//   converting those claims into an IdentityContext (a domain object) is
//   IdentityService's job; the separation matters:
//
//   JwtValidatorPort asks: "is this token valid, and what does it say?"
//   IdentityService asks:  "given these claims, who is this principal?"
//
//   if the port returned IdentityContext, it would need to know about tenant
//   resolution logic — a domain concern that belongs in the service, not in a
//   validation adapter
// 
// WHAT MUST BE VALIDATED (AD-S-04):
//   every incoming JWT must be checked for ALL of the following
//   partial validation is not acceptable — any missing check is a security hole
//
//   1. Signature  — RS256, verified against the tenant's stored RSA public key
//   2. Expiry     — exp claim must not be in the past
//   3. Issuer     — iss claim must be present
//   4. Audience   — aud claim must match the expected service scope
//                   (prevents cross-service token replay attacks)
//
// FAILURE SEMANTICS:
//   throws on any validation failure; the caller (IdentityService) catches
//   and translates to a denial; this port never returns partial or unvalidated
//   claims — it either returns a fully validated JwtClaims or throws
// 
// implemented by: adapters/jwt/JwtValidatorAdapter.ts
//
// this port exists to make IdentityService testable without a real JWT library.
// the adapter wraps jsonwebtoken and enforces RS256 + full claim validation (AD-S-04).
//
// plane: core/ports — no infrastructure imports here; ever

import type { TenantId, PrincipalId, RawToken } from "@domain/ids"

/**
 * the decoded, validated claims extracted from a JWT
 * this is the only thing that escapes the JWT boundary —
 * the raw token is consumed and discarded inside IdentityService
 */
export interface JwtClaims {
	tenantId: TenantId /** the tenant this token was issued for */
	principalId: PrincipalId /** the principal (user/service account) making the request */
	expiresAt: Date /** token expiry — already validated, surfaced here for audit record */
	issuer: string /** issuer claim (iss) */
	audience: string /** audience claim (aud) */
}

export interface JwtValidatorPort {
	/**
	 * validate a raw JWT and extract its claims
	 *
	 * MUST validate ALL of (AD-S-04)
	 *  - Signature — RS256, verified against the provided public key
	 *  - Expiry (exp) — must not be in the past
	 *  - Issuer (iss) — must be present
	 *  - Audience (aud) — must be present
	 *
	 * throws on any validation failure — the caller (IdentityService) catches
	 * and translates to a denial; never returns partial/invalidated claims
	 *
	 * @param token     - the raw JWT string (RawToken)
	 * @param publicKey - the tenant's RSA public key (PEM format)
	 * @param audience  - the expected audience value for this service scope
	 */
	validate(token: RawToken, publicKey: string, audience: string): Promise<JwtClaims>
}
