// the cache abstraction; consumed by:
//   - IdentityService (key fetch: tenant_id + key_version)
//   - PermissionResolver (permission projection: versioned composite key)
//
// implemented by: adapters/redis/RedisCacheAdapter.ts
//
// plane: core/ports — no infrastructure imports here; ever

export interface CachePort {
	/**
	 * retrieve a cached value by key
	 * returns null on cache miss — never throws on miss
	 * throws on infrastructure failure (connection lost, timeout)
	 */
	get(key: string): Promise<string | null>

	/**
	 * store a value with an optional TTL (seconds)
	 * TTL is a backstop only — version-counter invalidation is the primary mechanism (AD-P-07)
	 * throws an infrastructure failure
	 */
	set(key: string, value: string, ttlSeconds?: number): Promise<void>

	/**
	 * delete a cache entry explicity
	 * used by TenantRegistry (key rotation) and AccessControl (version bump)
	 * no-op if key does not exist
	 * throws on infrastructure failure
	 */
	del(key: string): Promise<void>

	/**
	 * acquire a distributed lock for the given key
	 * used by PermissionResolver to prevent cache stampede on version bump (AD-P-09)
	 * returns a release function — callers MUST call release() when done
	 * throws if the lock cannot be acquired within the timeout
	 *
	 * @param key       - lock key, typically scoped to tenant_id
	 * @param ttlMs     - lock TTL in milliseconds (auto-released if process crashes)
	 * @param timeoutMs - max wait time before throwing
	 */
	lock(key: string, ttlMs: number, timeoutMs: number): Promise<{ release: () => Promise<void> }>
}
