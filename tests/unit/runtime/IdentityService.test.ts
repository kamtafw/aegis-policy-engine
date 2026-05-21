// no real JWT library, no real Redis, no real Postgres;
// all ports are mocked — this tests IdentityService logic in isolation
//
// Coverage targets:
//   Cache hit path       — key fetched from cache, no DB call
//   Cache miss path      — DB fallback, key written to cache
//   Tenant not found     — throws IdentityError
//   Principal not found  — throws IdentityError
//   Missing tenantId     — throws IdentityError
//   Claim mismatch       — unverified tenantId ≠ verified tenantId → throws
//   Malformed token      — throws IdentityError
//   Key version          — keyVersion from cache entry surfaces in IdentityContext
//   principalVersion     — surfaces in IdentityContext from principal record
//
// What is NOT tested here:
//   Real JWT crypto (tested in adapters/jwt/JwtValidatorAdapter.test.ts, Day 13b)
//   Redis wire format (tested in integration tests, Day 17)

import { describe, it, expect, vi, beforeEach } from "vitest"
import { IdentityService, IdentityError, tenantKeyCacheKey } from "@core/runtime/IdentityService"
import type {
	CachePort,
	JwtValidatorPort,
	TenantRepositoryPort,
	PrincipalRepositoryPort,
} from "@core/ports"
import type { TenantId, PrincipalId } from "@core/domain"
import type { RouteContext } from "@core/runtime/context"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TENANT_ID = "ten_abc123" as TenantId
const PRINCIPAL_ID = "pri_xyz789" as PrincipalId
const PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq...\n-----END PUBLIC KEY-----"
const KEY_VERSION = 3
const PRINCIPAL_VERSION = 2
const AUDIENCE = "aegis"
const ISSUER = "https://auth.example.com"

// a minimal valid JWT — three dot-separated base64url segments;
// the payload (middle segment) encodes { tenantId, sub, iss, aud, exp }
function makeToken(payload: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
	const sig = "fakesig"
	return `${header}.${body}.${sig}`
}

const VALID_PAYLOAD = {
	tenantId: TENANT_ID,
	sub: PRINCIPAL_ID,
	iss: ISSUER,
	aud: AUDIENCE,
	exp: Math.floor(Date.now() / 1000) + 3600,
}

const VALID_TOKEN = makeToken(VALID_PAYLOAD) as unknown as import("@core/domain").RawToken

const ROUTE_CONTEXT: RouteContext = {
	routeId: "rte_001" as import("@core/domain").RouteId,
	method: "GET",
	action: "billing:read" as import("@core/domain").ActionSlug,
	resourceType: "billing" as import("@core/domain").ResourceSlug,
	requestMetadata: {},
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeCachePort(overrides?: Partial<CachePort>): CachePort {
	return {
		get: vi.fn().mockResolvedValue(null), // cache miss by default
		set: vi.fn().mockResolvedValue(undefined),
		del: vi.fn().mockResolvedValue(undefined),
		lock: vi.fn().mockResolvedValue({ release: vi.fn() }),
		...overrides,
	}
}

function makeJwtValidator(overrides?: Partial<JwtValidatorPort>): JwtValidatorPort {
	return {
		validate: vi.fn().mockResolvedValue({
			tenantId: TENANT_ID,
			principalId: PRINCIPAL_ID,
			expiresAt: new Date(Date.now() + 3600000),
			issuer: ISSUER,
			audience: AUDIENCE,
		}),
		...overrides,
	}
}

function makeTenantRepo(overrides?: Partial<TenantRepositoryPort>): TenantRepositoryPort {
	return {
		create: vi.fn(),
		findById: vi.fn().mockResolvedValue({
			id: TENANT_ID,
			slug: "test-tenant",
			name: "Test Tenant",
			publicKey: PUBLIC_KEY,
			keyVersion: KEY_VERSION,
			policyVersion: 1,
			planTier: "free",
			createdAt: new Date(),
		}),
		incrementKeyVersion: vi.fn(),
		incrementPolicyVersion: vi.fn(),
		...overrides,
	}
}

function makePrincipalRepo(overrides?: Partial<PrincipalRepositoryPort>): PrincipalRepositoryPort {
	return {
		create: vi.fn(),
		findById: vi.fn().mockResolvedValue({
			id: PRINCIPAL_ID,
			tenantId: TENANT_ID,
			externalId: "ext_user_001",
			metadata: {},
			principalVersion: PRINCIPAL_VERSION,
			createdAt: new Date(),
		}),
		listByTenant: vi.fn(),
		assignRole: vi.fn(),
		incrementVersion: vi.fn(),
		...overrides,
	}
}

function makeService(overrides?: {
	cache?: Partial<CachePort>
	jwt?: Partial<JwtValidatorPort>
	tenant?: Partial<TenantRepositoryPort>
	principal?: Partial<PrincipalRepositoryPort>
}) {
	return new IdentityService(
		makeJwtValidator(overrides?.jwt),
		makeCachePort(overrides?.cache),
		makeTenantRepo(overrides?.tenant),
		makePrincipalRepo(overrides?.principal),
		AUDIENCE,
	)
}

// ---------------------------------------------------------------------------
// Tests — happy path
// ---------------------------------------------------------------------------

describe("IdentityService.resolve — cache miss path", () => {
	it("fetches tenant key from DB when cache misses and writes it back", async () => {
		const cache = makeCachePort()
		const tenantRepo = makeTenantRepo()
		const service = new IdentityService(
			makeJwtValidator(),
			cache,
			tenantRepo,
			makePrincipalRepo(),
			AUDIENCE,
		)

		await service.resolve(VALID_TOKEN, ROUTE_CONTEXT)

		// Cache was checked
		expect(cache.get).toHaveBeenCalledWith(tenantKeyCacheKey(TENANT_ID))
		// DB was hit on miss
		expect(tenantRepo.findById).toHaveBeenCalledWith(TENANT_ID)
		// Key was written to cache
		expect(cache.set).toHaveBeenCalledOnce()
		const [key, value] = (cache.set as ReturnType<typeof vi.fn>).mock.calls[0]
		expect(key).toBe(tenantKeyCacheKey(TENANT_ID))
		const cached = JSON.parse(value as string)
		expect(cached).toMatchObject({ publicKey: PUBLIC_KEY, keyVersion: KEY_VERSION })
	})

	it("returns IdentityContext with correct fields from DB path", async () => {
		const service = makeService()
		const ctx = await service.resolve(VALID_TOKEN, ROUTE_CONTEXT)

		expect(ctx.tenantId).toBe(TENANT_ID)
		expect(ctx.principalId).toBe(PRINCIPAL_ID)
		expect(ctx.keyVersion).toBe(KEY_VERSION)
		expect(ctx.principalVersion).toBe(PRINCIPAL_VERSION)
	})
})

describe("IdentityService.resolve — cache hit path", () => {
	it("uses cached key without hitting the DB", async () => {
		const cachedEntry = JSON.stringify({ publicKey: PUBLIC_KEY, keyVersion: KEY_VERSION })
		const cache = makeCachePort({
			get: vi.fn().mockResolvedValue(cachedEntry),
		})
		const tenantRepo = makeTenantRepo()

		const service = new IdentityService(
			makeJwtValidator(),
			cache,
			tenantRepo,
			makePrincipalRepo(),
			AUDIENCE,
		)

		await service.resolve(VALID_TOKEN, ROUTE_CONTEXT)

		// Cache hit — DB should not be called for the key
		expect(tenantRepo.findById).not.toHaveBeenCalled()
		// Key should not be re-written to cache
		expect(cache.set).not.toHaveBeenCalled()
	})

	it("returns keyVersion from cache entry, not DB", async () => {
		const cachedKeyVersion = 99
		const cachedEntry = JSON.stringify({ publicKey: PUBLIC_KEY, keyVersion: cachedKeyVersion })
		const cache = makeCachePort({ get: vi.fn().mockResolvedValue(cachedEntry) })

		const service = new IdentityService(
			makeJwtValidator(),
			cache,
			makeTenantRepo(),
			makePrincipalRepo(),
			AUDIENCE,
		)

		const ctx = await service.resolve(VALID_TOKEN, ROUTE_CONTEXT)

		// Must use the cached version, not whatever DB would return
		expect(ctx.keyVersion).toBe(cachedKeyVersion)
	})
})

// ---------------------------------------------------------------------------
// Tests — failure paths
// ---------------------------------------------------------------------------

describe("IdentityService.resolve — tenant not found", () => {
	it("throws IdentityError when tenant is not in DB (cache miss scenario)", async () => {
		const service = makeService({
			tenant: { findById: vi.fn().mockResolvedValue(null) },
		})

		await expect(service.resolve(VALID_TOKEN, ROUTE_CONTEXT)).rejects.toThrow(IdentityError)
		await expect(service.resolve(VALID_TOKEN, ROUTE_CONTEXT)).rejects.toThrow(/Tenant not found/i)
	})
})

describe("IdentityService.resolve — principal not found", () => {
	it("throws IdentityError when principal does not exist in this tenant", async () => {
		const service = makeService({
			principal: { findById: vi.fn().mockResolvedValue(null) },
		})

		await expect(service.resolve(VALID_TOKEN, ROUTE_CONTEXT)).rejects.toThrow(IdentityError)
		await expect(service.resolve(VALID_TOKEN, ROUTE_CONTEXT)).rejects.toThrow(
			/Principal.*not found/i,
		)
	})
})

describe("IdentityService.resolve — malformed token", () => {
	it("throws IdentityError when token has fewer than three segments", async () => {
		const badToken =
			"not.a.valid.jwt.with.too.many.parts" as unknown as import("@core/domain").RawToken
		// Actually let's use genuinely wrong ones
		const noSegments = "nodots" as unknown as import("@core/domain").RawToken
		const service = makeService()
		await expect(service.resolve(noSegments, ROUTE_CONTEXT)).rejects.toThrow(IdentityError)
	})

	it("throws IdentityError when payload is not valid JSON", async () => {
		const header = Buffer.from("{}").toString("base64url")
		const badPayload = Buffer.from("not-json!!!").toString("base64url")
		const badToken = `${header}.${badPayload}.fakesig` as unknown as import("@core/domain").RawToken

		const service = makeService()
		await expect(service.resolve(badToken, ROUTE_CONTEXT)).rejects.toThrow(IdentityError)
	})

	it("throws IdentityError when tenantId claim is missing from payload", async () => {
		const tokenWithoutTenantId = makeToken({
			sub: PRINCIPAL_ID,
			iss: ISSUER,
			aud: AUDIENCE,
			exp: Math.floor(Date.now() / 1000) + 3600,
			// tenantId omitted
		}) as unknown as import("@core/domain").RawToken

		const service = makeService()
		await expect(service.resolve(tokenWithoutTenantId, ROUTE_CONTEXT)).rejects.toThrow(
			IdentityError,
		)
		await expect(service.resolve(tokenWithoutTenantId, ROUTE_CONTEXT)).rejects.toThrow(/tenantId/i)
	})
})

describe("IdentityService.resolve — tenantId mismatch", () => {
	it("throws IdentityError when unverified tenantId differs from verified tenantId", async () => {
		// The unverified payload claims tenantId=A, but the JWT validator
		// (simulating a forged token that passed verification against wrong key)
		// returns tenantId=B. Should be caught and rejected.
		const jwtValidator = makeJwtValidator({
			validate: vi.fn().mockResolvedValue({
				tenantId: "ten_DIFFERENT" as TenantId,
				principalId: PRINCIPAL_ID,
				expiresAt: new Date(),
				issuer: ISSUER,
				audience: AUDIENCE,
			}),
		})

		const service = new IdentityService(
			jwtValidator,
			makeCachePort(),
			makeTenantRepo(),
			makePrincipalRepo(),
			AUDIENCE,
		)

		await expect(service.resolve(VALID_TOKEN, ROUTE_CONTEXT)).rejects.toThrow(IdentityError)
		await expect(service.resolve(VALID_TOKEN, ROUTE_CONTEXT)).rejects.toThrow(/mismatch/i)
	})
})

describe("IdentityService.resolve — JwtValidatorPort receives correct arguments", () => {
	it("passes publicKey from cache and the configured audience to the validator", async () => {
		const cachedEntry = JSON.stringify({ publicKey: PUBLIC_KEY, keyVersion: KEY_VERSION })
		const cache = makeCachePort({ get: vi.fn().mockResolvedValue(cachedEntry) })
		const jwtValidator = makeJwtValidator()

		const service = new IdentityService(
			jwtValidator,
			cache,
			makeTenantRepo(),
			makePrincipalRepo(),
			AUDIENCE,
		)

		await service.resolve(VALID_TOKEN, ROUTE_CONTEXT)

		expect(jwtValidator.validate).toHaveBeenCalledWith(VALID_TOKEN, PUBLIC_KEY, AUDIENCE)
	})
})
