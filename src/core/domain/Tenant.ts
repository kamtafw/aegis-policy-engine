// Tenant — the top-level isolation boundary in Aegis
//
// every piece of data in the system belongs to a tenant
// a tenant carries its cryptographic identity (public key + key_version)
// and its operational state (policy_version, plan_tier).
//
// this type is the domain representation — not a DB row, not an API response
// Adapters translate between DB rows and this type at the boundary

import type { TenantId } from "./ids"

export type PlanTier = "free" | "pro" | "enterprise"

export interface Tenant {
	readonly id: TenantId
	readonly slug: string
	readonly name: string
	readonly publicKey: string /** RSA public key in PEM format — used for JWT signature verification (AD-S-04) */
	readonly keyVersion: number /** incremented on every key rotation — scopes the key cache entry (AD-P-07) */
	readonly policyVersion: string /** incremented on every policy/role/permission change — scopes decision cache (AD-P-07) */
	readonly planTier: PlanTier
	readonly createdAt: Date
}
