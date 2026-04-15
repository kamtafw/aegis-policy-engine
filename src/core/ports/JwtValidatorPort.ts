// the JWT validation abstraction; consumed by:
//   - IdentityService
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
