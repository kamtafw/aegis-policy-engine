// SINGLE RESPONSIBILITY: consume a RawToken, produce an IdentityContext
// the JWT enters here and never leaves; no other component sees the raw token
//
// PIPELINE POSITION (AD-C-06):
//   called by EnforcementPipeline as the first stage;
//   receives (rawToken, routeContext) — rawToken as a parallel parameter,
//   never embedded in RouteContext (AD-C-06)
//
// KEY FETCH SEMANTICS (AD-P-07a):
//   the public key is fetched ONCE at the start of resolve() into a local
//   variable; it is not re-queried during validation; if the cache is
//   invalidated mid-flight, the in-progress request completes against the
//   key it resolved; the next request picks up the rotated key
//
// FAIL-CLOSED BEHAVIOUR (AD-S-07):
//   any error — missing claim, tenant not found, principal not found,
//   invalid signature, expired token — throws; EnforcementPipeline catches
//   and translates to a deny decision
//
// JWT DISPOSAL:
//   rawToken is accepted as a parameter and passed only to jwtValidator.validate();
//   it is not stored, returned, logged, or placed in any context object;
//   after validate() returns, rawToken is unreachable
//
// DESIGN NOTE — JWT sub = Aegis principalId:
//   The JWT `sub` claim carries the Aegis internal principalId (e.g. "pri_xxx").
//   The `externalId` field on the Principal domain type is for admin display
//   and external system correlation — it is not what appears in `sub`.
//   This means the issuing system must know the Aegis principalId at token
//   mint time. This is acceptable: token issuance is a trusted server-side
//   operation (not a client-controlled flow).
//
// plane: core/runtime — no imports from adapters; ever

import type { RawToken, TenantId } from "@core/domain"
import type {
	CachePort,
	JwtValidatorPort,
	PrincipalRepositoryPort,
	TenantRepositoryPort,
} from "@core/ports"
import type { IdentityContext, RouteContext } from "./context"

// cache key for tenant public key entries
// TenantRegistry must call cache.del(tenantKeyCacheKey(id)) on key rotation (Day 19)
export const tenantKeyCacheKey = (tenantId: TenantId) => `publicKey:${tenantId}`

// TTL is a backstop only; explicit invalidation on key rotation is the primary mechanism (AD-P-07)
const KEY_CACHE_TTL_SECONDS = 3600 // 1 hour

interface TenantKeyEntry {
	publicKey: string
	keyVersion: number
}

export class IdentityService {
	constructor(
		private readonly jwtValidator: JwtValidatorPort,
		private readonly cache: CachePort,
		private readonly tenantRepo: TenantRepositoryPort,
		private readonly principalRepo: PrincipalRepositoryPort,
		// the expected `aud` claim value; must match the issuer's audience;
		// prevents cross-service token replay (AD-S-04)
		private readonly expectedAudience: string,
	) {}

	async resolve(rawToken: RawToken, _routeContext: RouteContext): Promise<IdentityContext> {
		// step 1 —  extract tenantId from unverified payload;
		//   tenantId is needed to know which public key to fetch;
		//   reading the payload bytes without verifying the signature is safe:
		//   do not trust anything from this decode — verification happens next
		const unverified = decodeUnverifiedPayload(rawToken)
		const rawTenantId = unverified["tenantId"]
		if (typeof rawTenantId !== "string" || rawTenantId.length === 0) {
			throw new IdentityError("JWT missing or invalid tenantId claim")
		}
		const tenantId = rawTenantId as TenantId

		// step 2 — single atomic key fetch (AD-P-07a)
		//   fetched once here; not re-queried during validation
		const { publicKey, keyVersion } = await this.fetchTenantKey(tenantId)

		// step 3 — full JWT validation (AD-S-04)
		//   validates: signature (RS256), exp, iss, aud
		//   rawToken is consumed here; never returns from this boundary
		//   any failure throws — caller denies
		const claims = await this.jwtValidator.validate(rawToken, publicKey, this.expectedAudience)

		// step 4 — verify tenantId is consistent between unverified and verified claims
		//   the unverified decode tells which key to fetch; the verified decode confirms
		//   the payload was not tampered with
		if (claims.tenantId !== tenantId) {
			throw new IdentityError("tenantId mismatch between decoded and verified JWT claims")
		}

		// step 5 — resolve principal to obtain principalVersion
		//   principalVersion is needed by PermissionResolver to construct
		//   a version-scoped cache key (AD-P-08); it must be fetched here
		//   so PermissionResolver does not need a separate DB call on the happy path
		const principal = await this.principalRepo.findById(tenantId, claims.principalId)
		if (!principal) {
			// principal in valid JWT does not exists in this tenant — deny (AD-S-07)
			throw new IdentityError(`Principal '${claims.principalId}' not found in tenant '${tenantId}'`)
		}

		// rawToken is not referenced after this point; IdentityContext carries no token material
		return {
			tenantId: claims.tenantId,
			principalId: claims.principalId,
			keyVersion,
			principalVersion: principal.principalVersion,
		}
	}

	// key resolution — cache-first with DB fallback
	private async fetchTenantKey(tenantId: TenantId): Promise<TenantKeyEntry> {
		const cacheKey = tenantKeyCacheKey(tenantId)

		// cache hit — fast path; throws on infrastructure failure (AD-S-07)
		const cached = await this.cache.get(cacheKey)
		if (cached !== null) {
			return JSON.parse(cached) as TenantKeyEntry
		}

		// cache miss — fetch from DB
		const tenant = await this.tenantRepo.findById(tenantId)
		if (!tenant) {
			throw new IdentityError(`Tenant not found: ${tenantId}`)
		}

		const entry: TenantKeyEntry = {
			publicKey: tenant.publicKey,
			keyVersion: tenant.keyVersion,
		}

		// write to cache; TTL is backstop only; TenantRegistry deletes this
		// entry on key rotation (Day 19, tenantKeyCacheKey export above)
		await this.cache.set(cacheKey, JSON.stringify(entry), KEY_CACHE_TTL_SECONDS)

		return entry
	}
}

// IdentityError — thrown on any validation or resolution failure
// EnforcementPipeline catches this and translates to a deny (AD-S-07)
export class IdentityError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "IdentityError"
	}
}

// unverified payload decode
//
// reads the JWT payload section (middle base64url segment) without
// verifying the signature; this is structurally safe — action don't
// need to be taken on any claim extracted here until after full verification
//
// used only to extract tenantId so to know which key to fetch
// no crypto dependency — only base64 decoding
function decodeUnverifiedPayload(token: RawToken): Record<string, unknown> {
	const parts = (token as string).split(".")
	if (parts.length !== 3) {
		throw new IdentityError("Malformed JWT: expected three dot-separated segments")
	}

	const payloadSegment = parts[1]
	if (!payloadSegment) {
		throw new IdentityError("Malformed JWT: empty payload segment")
	}

	let payloadJson: string
	try {
		payloadJson = Buffer.from(payloadSegment, "base64url").toString("utf-8")
	} catch {
		throw new IdentityError("Malformed JWT: failed to base64-decode payload segment")
	}

	try {
		return JSON.parse(payloadJson) as Record<string, unknown>
	} catch {
		throw new IdentityError("Malformed JWT: payload is not valid JSON")
	}
}
