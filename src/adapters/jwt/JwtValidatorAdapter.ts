// the only file in the codebase that imports jsonwebtoken
// all JWT crypto is contained here; Core never sees the library
//
// VALIDATION CONTRACT (AD-S-04):
//   Every call to validate() MUST check ALL of:
//     1. Signature — RS256, verified against the caller-supplied public key
//     2. Expiry (exp) — jsonwebtoken rejects expired tokens by default
//     3. Issuer (iss) — verified if expectedIssuer is supplied to constructor
//     4. Audience (aud) — verified against the audience parameter on each call
//
//   partial validation is not acceptable; each check is listed explicitly
//   below so an auditor can verify completeness without knowing the library API
//
// ERROR HANDLING:
//   all jsonwebtoken errors are caught and re-thrown as JwtValidationError;
//   raw library errors are never propagated — their message strings may contain
//   token material or internal details that must not leak into logs
//
// CLAIMS CONTRACT:
//   Expected JWT payload shape:
//     {
//       sub:      string  — Aegis principalId (e.g. "pri_xxx")
//       tenantId: string  — Aegis tenantId (e.g. "ten_xxx")
//       iss:      string  — issuer URI
//       aud:      string  — audience (must match expectedAudience)
//       exp:      number  — Unix timestamp (validated by library)
//     }
//
//   if any required claim is absent or has the wrong type, throws;
//   claims are validated after signature verification — unverified fields
//   are never read for any decision purpose
//
// plane: adapters — core never imports this file

import type { PrincipalId, RawToken, TenantId } from "@core/domain"
import type { JwtClaims, JwtValidatorPort } from "@core/ports"
import jwt from "jsonwebtoken"

export class JwtValidationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "JwtValidationError"
	}
}

export class JwtValidatorAdapter implements JwtValidatorPort {
	constructor(
		// optional: if provided, the `iss` claim is verified against this value;
		// if omitted, issuer is extracted from the token but not checked against a fixed value
		// for production use, always supply expectedIssuer (AD-S-04)
		private readonly expectedIssuer?: string,
	) {}

	async validate(token: RawToken, publicKey: string, audience: string): Promise<JwtClaims> {
		let decoded: jwt.JwtPayload

		try {
			// jwt.verify throws on any of:
			//   - invalid signature
			//   - expired tokens (exp in the past)
			//   - audience mismatch (aud !== audience)
			//   - issuer mismatch (if algorithm option includes it)
			const verifyOptions: jwt.VerifyOptions = {
				algorithms: ["RS256"], // [1] signature algorithm — RS256 only (AD-S-04)
				audience, // [4] audience claim — prevents cross-service replay
				...(this.expectedIssuer ? { issuer: this.expectedIssuer } : {}), // [3] issuer
				// [2] expiry — enforced by jsonwebtoken by default (clockTolerance: 0)
			}

			decoded = jwt.verify(token as string, publicKey, verifyOptions) as jwt.JwtPayload
		} catch (err) {
			// never propagate library errors directly — they contain token fragments
			// map to a sanitised message that is safe to log
			const reason = classifyJwtError(err)
			throw new JwtValidationError(`JWT validation failed: ${reason}`)
		}

		// after successful verify(), extract and type-check claims
		// jwt.verify only guarantees the token is cryptographically valid and
		// temporarily valid — it does not guarantee the custom claims are present
		return extractClaims(decoded)
	}
}

// claim extraction — called only after full signature + temporal verification
function extractClaims(payload: jwt.JwtPayload): JwtClaims {
	// sub — Aegis principalId
	if (typeof payload["sub"] !== "string" || payload["sub"].length === 0) {
		throw new JwtValidationError("JWT missing or invalid sub claim")
	}

	// tenantId — custom claim
	if (typeof payload["tenantId"] !== "string" || payload["tenantId"].length === 0) {
		throw new JwtValidationError("JWT missing or invalid tenantId claim")
	}

	// iss — issuer (present if verification passed with expectedIssuer, or extract as-is)
	if (typeof payload["iss"] !== "string" || payload["iss"].length === 0) {
		throw new JwtValidationError("JWT missing or invalid iss claim")
	}

	// aud — audience (already verified by jwt.verify; extract for surfacing in JwtClaims)
	const rawAud = payload["aud"]
	const audience =
		typeof rawAud === "string"
			? rawAud
			: Array.isArray(rawAud) && typeof rawAud[0] === "string"
				? rawAud[0]
				: null

	if (!audience) {
		throw new JwtValidationError("JWT missing or invalid aud claim")
	}

	// exp — expiry (already enforced by jwt.verify; surface as Date for audit record)
	if (typeof payload["exp"] !== "number") {
		throw new JwtValidationError("JWT missing exp claim")
	}
	
	return {
		tenantId: payload["tenantId"] as TenantId,
		principalId: payload["sub"] as PrincipalId,
		expiresAt: new Date(payload["exp"] * 1000),
		issuer: payload["iss"],
		audience,
	}
}

// error classifier — produces safe log strings without token material
function classifyJwtError(err: unknown): string {
	if (!(err instanceof Error)) return "unknown error"

	switch (err.name) {
		case "TokenExpiredError":
			return "token expired"
		case "JsonWebTokenError":
			return "invalid token" // covers: invalid signature, malformed token, algorithm mismatch
		case "NotBeforeError":
			return "token not yet valid"
		default:
			return "validation error"
	}
}
