// unit tests for the PolicyEngine pure function
//
// No mocks. No setup. No teardown.
// The function takes values and returns values — tests do the same.
//
// Coverage targets:
//   ANY strategy:
//     - single permission, held → allow + correct reason
//     - single permission, not held → deny + lists the permission
//     - multiple permissions, first held → allow + short-circuit (only first checked)
//     - multiple permissions, none first, last held → allow
//     - multiple permissions, none held → deny + lists all
//   ALL strategy:
//     - single permission, held → allow
//     - single permission, not held → deny + names missing permission
//     - multiple permissions, all held → allow
//     - multiple permissions, first missing → deny + short-circuit (names first)
//     - multiple permissions, last missing → deny + names last
//   Cross-cutting:
//     - deleted permission (AD-C-04) — treated as unsatisfied
//     - empty requiredPermissions — deny (fail closed, AD-S-07)
//     - version numbers pass through to Decision correctly
//     - reason strings are self-explanatory (AD-T-04)

import { describe, it, expect } from "vitest"
import { evaluate } from "@core/runtime/PolicyEngine"
import type { Policy } from "@core/ports"
import type { TenantId, PolicyId, PermissionSlug } from "@core/domain"

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

const TENANT_ID = "ten_test" as TenantId
const POLICY_VERSION = 3
const PRINCIPAL_VERSION = 2

const slug = (s: string) => s as PermissionSlug

const permSet = (...slugs: string[]): ReadonlySet<PermissionSlug> => new Set(slugs.map(slug))

const makePolicy = (
	overrides: Partial<Pick<Policy, "requiredPermissions" | "matchStrategy">>,
): Policy => {
	return {
		id: "pol_test" as PolicyId,
		tenantId: TENANT_ID,
		name: "test_policy",
		contextVersion: "v1",
		matchStrategy: "ANY",
		requiredPermissions: [slug("billing:read")],
		...overrides,
	}
}

// ---------------------------------------------------------------------------
// ANY strategy
// ---------------------------------------------------------------------------
describe("PolicyEngine — ANY strategy", () => {
	it("allows when the principal holds the single required permission", () => {
		const policy = makePolicy({ matchStrategy: "ANY", requiredPermissions: [slug("billing:read")] })
		const permissions = permSet("billing:read")

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(true)
		expect(decision.reason).toContain("billing:read")
		expect(decision.evaluatedPolicyVersion).toBe(POLICY_VERSION)
		expect(decision.evaluatedPrincipalVersion).toBe(PRINCIPAL_VERSION)
	})

	it("denies when the principal does not hold the single required permission", () => {
		const policy = makePolicy({ matchStrategy: "ANY", requiredPermissions: [slug("billing:read")] })
		const permissions = permSet("reports:export")

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(false)
		expect(decision.reason).toContain("billing:read")
	})

	it("allows on the first matching permission and short-circuits", () => {
		const required = [slug("billing:read"), slug("billing:export"), slug("reports:export")]
		const policy = makePolicy({ matchStrategy: "ANY", requiredPermissions: required })
		// only the first permission is held — expect short-circuit on first match.
		const permissions = permSet("billing:read")

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(true)
		// reason must name the deciding permission, not a later one.
		expect(decision.reason).toContain("billing:read")
		expect(decision.reason).not.toContain("billing:export")
		expect(decision.reason).not.toContain("reports:export")
	})

	it("allows when a later permission (not the first) is held", () => {
		const required = [slug("billing:read"), slug("billing:export"), slug("reports:export")]
		const policy = makePolicy({ matchStrategy: "ANY", requiredPermissions: required })
		const permissions = permSet("reports:export") // only the last

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(true)
		expect(decision.reason).toContain("reports:export")
	})

	it("denies when no required permission is held, listing all in reason", () => {
		const required = [slug("billing:read"), slug("billing:export")]
		const policy = makePolicy({ matchStrategy: "ANY", requiredPermissions: required })
		const permissions = permSet("deploy:execute") // unrelated permission

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(false)
		// reason must list all required permissions so the operator knows what to grant.
		expect(decision.reason).toContain("billing:read")
		expect(decision.reason).toContain("billing:export")
	})

	it("allows when the principal holds more permissions than required (superset)", () => {
		const policy = makePolicy({ matchStrategy: "ANY", requiredPermissions: [slug("billing:read")] })
		const permissions = permSet("billing:read", "billing:export", "reports:export")

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// ALL strategy
// ---------------------------------------------------------------------------
describe("PolicyEngine — ALL strategy", () => {
	it("allows when the principal holds the single required permission", () => {
		const policy = makePolicy({ matchStrategy: "ALL", requiredPermissions: [slug("billing:read")] })
		const permissions = permSet("billing:read")

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(true)
		expect(decision.evaluatedPolicyVersion).toBe(POLICY_VERSION)
		expect(decision.evaluatedPrincipalVersion).toBe(PRINCIPAL_VERSION)
	})

	it("denies when the principal is missing the single required permission", () => {
		const policy = makePolicy({ matchStrategy: "ALL", requiredPermissions: [slug("billing:read")] })
		const permissions = permSet("reports:export")

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(false)
		// reason must name the specific missing permission.
		expect(decision.reason).toContain("billing:read")
	})

	it("allows when the principal holds all required permissions", () => {
		const required = [slug("billing:read"), slug("billing:read:restricted"), slug("billing:export")]
		const policy = makePolicy({ matchStrategy: "ALL", requiredPermissions: required })
		const permissions = permSet("billing:read", "billing:read:restricted", "billing:export")

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(true)
	})

	it("denies on the first missing permission and short-circuits", () => {
		const required = [slug("billing:read"), slug("billing:read:restricted"), slug("billing:export")]
		const policy = makePolicy({ matchStrategy: "ALL", requiredPermissions: required })
		// missing the first permission — expect short-circuit.
		const permissions = permSet("billing:read:restricted", "billing:export")

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(false)
		// reason must name the first missing permission specifically.
		expect(decision.reason).toContain("billing:read")
		// must not reference later permissions — those were never checked.
		expect(decision.reason).not.toContain("billing:read:restricted")
		expect(decision.reason).not.toContain("billing:export")
	})

	it("denies when the last permission in the list is missing", () => {
		const required = [slug("billing:read"), slug("billing:read:restricted"), slug("billing:export")]
		const policy = makePolicy({ matchStrategy: "ALL", requiredPermissions: required })
		const permissions = permSet("billing:read", "billing:read:restricted") // last is missing

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(false)
		expect(decision.reason).toContain("billing:export")
	})

	it("denies when the principal holds no permissions at all", () => {
		const required = [slug("billing:read"), slug("billing:export")]
		const policy = makePolicy({ matchStrategy: "ALL", requiredPermissions: required })
		const permissions = permSet() // empty

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(false)
		// first required permission is the deciding one.
		expect(decision.reason).toContain("billing:read")
	})
})

// ---------------------------------------------------------------------------
// AD-C-04 — Deleted permissions treated as unsatisfied
// ---------------------------------------------------------------------------
describe("PolicyEngine — deleted permissions (AD-C-04)", () => {
	it("treats a deleted permission as unsatisfied under ANY — denies if it is the only required one", () => {
		// the policy references a permission slug that was deleted from the DB;
		// it will not appear in the principal's flat permission set
		const deletedSlug = slug("deploy:execute:production")
		const policy = makePolicy({ matchStrategy: "ANY", requiredPermissions: [deletedSlug] })
		const permissions = permSet() // principal's set — deleted permission is absent

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		// no special error — just a normal denial. Deleted === not held.
		expect(decision.allowed).toBe(false)
		expect(decision.reason).toContain("deploy:execute:production")
	})

	it("treats a deleted permission as unsatisfied under ALL — denies and names it", () => {
		const deletedSlug = slug("billing:read:restricted")
		const required = [slug("billing:read"), deletedSlug]
		const policy = makePolicy({ matchStrategy: "ALL", requiredPermissions: required })
		// Principal holds the live permission but not the deleted one
		const permissions = permSet("billing:read")

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(false)
		expect(decision.reason).toContain("billing:read:restricted")
	})

	it("allows under ANY if the principal holds a live permission alongside a deleted one", () => {
		const deletedSlug = slug("deploy:execute:production")
		const liveSlug = slug("deploy:execute:staging")
		const policy = makePolicy({
			matchStrategy: "ANY",
			requiredPermissions: [deletedSlug, liveSlug],
		})
		const permissions = permSet("deploy:execute:staging")

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		// ANY — the live permission satisfies the policy
		expect(decision.allowed).toBe(true)
		expect(decision.reason).toContain("deploy:execute:staging")
	})
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("PolicyEngine — edge cases", () => {
	it("denies when requiredPermissions is empty (fail closed, AD-S-07)", () => {
		const policy = makePolicy({ matchStrategy: "ANY", requiredPermissions: [] })
		const permissions = permSet("billing:read", "billing:export")

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(false)
		expect(decision.reason).toContain("no required permissions")
	})

	it("denies for ALL with empty requiredPermissions (fail closed)", () => {
		const policy = makePolicy({ matchStrategy: "ALL", requiredPermissions: [] })
		const permissions = permSet("billing:read")

		const decision = evaluate(policy, permissions, POLICY_VERSION, PRINCIPAL_VERSION)

		expect(decision.allowed).toBe(false)
	})

	it("passes version numbers through to the Decision unchanged", () => {
		const policy = makePolicy({ matchStrategy: "ANY", requiredPermissions: [slug("billing:read")] })
		const permissions = permSet("billing:read")

		const decision = evaluate(policy, permissions, 42, 99)

		expect(decision.evaluatedPolicyVersion).toBe(42)
		expect(decision.evaluatedPrincipalVersion).toBe(99)
	})

	it("reason strings are self-explanatory without knowledge of the system (AD-T-04)", () => {
		// an allow reason should name the permission that permitted access
		const allowDecision = evaluate(
			makePolicy({ matchStrategy: "ANY", requiredPermissions: [slug("billing:read")] }),
			permSet("billing:read"),
			1,
			1,
		)
		expect(allowDecision.reason).toMatch(/billing:read/)
		expect(allowDecision.reason).toMatch(/allow/i)

		// a deny reason should name the permission that was missing or decisive
		const denyDecision = evaluate(
			makePolicy({ matchStrategy: "ALL", requiredPermissions: [slug("billing:read:restricted")] }),
			permSet(),
			1,
			1,
		)
		expect(denyDecision.reason).toMatch(/billing:read:restricted/)
		expect(denyDecision.reason).toMatch(/denied|missing/i)
	})
})
