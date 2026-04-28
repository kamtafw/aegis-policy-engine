// unit tests for AccessControlService.flattenPermissions (AD-P-03)
//
// Strategy:
//   The four cases from the Day 7 spec are tested here.
//   The repository layer is mocked — these tests are pure logic tests,
//   not integration tests. No database, no network.
//
//   What is under test: does flattenPermissions correctly wrap the
//   repository result in a Set, and does the Set deduplicate correctly?
//
//   What is NOT under test: the SQL query itself. That is covered by
//   integration tests in tests/integration/ (Day 15 scope).
//
// Vitest is used — no additional config needed beyond what Day 1 scaffolded.

import { describe, it, expect, vi } from "vitest"
import { AccessControlService } from "@core/management/access-control/AccessControlService"
import type { TenantId, PrincipalId, PermissionSlug } from "@core/domain"

// ---------------------------------------------------------------------------
// Typed test fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = "ten_test-tenant" as TenantId
const PRINCIPAL_ID = "pri_test-principal" as PrincipalId

// Helpers to cast slugs without repetition in every test
const slug = (s: string) => s as PermissionSlug

// ---------------------------------------------------------------------------
// Mock factories
//
// We only mock the methods each test needs. Methods not present on the mock
// will throw if called unexpectedly — which is the correct failure mode.
// ---------------------------------------------------------------------------

function makeRoleRepo(slugsToReturn: string[]) {
	return {
		getFlatPermissionSlugs: vi
			.fn()
			.mockResolvedValue(slugsToReturn.map((s) => s as PermissionSlug)),
		// Other methods — not called by flattenPermissions
		create: vi.fn(),
		findById: vi.fn(),
		listByTenant: vi.fn(),
		assignPermission: vi.fn(),
	}
}

function makeService(roleRepo: ReturnType<typeof makeRoleRepo>) {
	// AccessControlService constructor: principalRepo, tenantRepo, roleRepo, permissionRepo
	// flattenPermissions only uses roleRepo — the others can be empty stubs.
	const stub = {} as never
	return new AccessControlService(stub, stub, roleRepo as never, stub)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AccessControlService.flattenPermissions", () => {
	// -------------------------------------------------------------------------
	// Case 1 — single role with permissions
	// -------------------------------------------------------------------------
	it("returns slugs from a single assigned role", async () => {
		const roleRepo = makeRoleRepo(["billing:read", "billing:export"])
		const service = makeService(roleRepo)

		const result = await service.flattenPermissions(PRINCIPAL_ID, TENANT_ID)

		expect(result).toBeInstanceOf(Set)
		expect(result.size).toBe(2)
		expect(result.has(slug("billing:read"))).toBe(true)
		expect(result.has(slug("billing:export"))).toBe(true)

		// Verify the repository was called with the correct tenant + principal
		expect(roleRepo.getFlatPermissionSlugs).toHaveBeenCalledOnce()
		expect(roleRepo.getFlatPermissionSlugs).toHaveBeenCalledWith(TENANT_ID, PRINCIPAL_ID)
	})

	// -------------------------------------------------------------------------
	// Case 2 — multiple roles, disjoint permissions
	// -------------------------------------------------------------------------
	it("unions permissions from multiple roles", async () => {
		// The DB query returns the full flat list across all roles.
		// From the service's perspective this is just a longer array.
		const roleRepo = makeRoleRepo([
			"billing:read",
			"billing:export",
			"deploy:execute:staging",
			"reports:export",
		])
		const service = makeService(roleRepo)

		const result = await service.flattenPermissions(PRINCIPAL_ID, TENANT_ID)

		expect(result.size).toBe(4)
		expect(result.has(slug("billing:read"))).toBe(true)
		expect(result.has(slug("billing:export"))).toBe(true)
		expect(result.has(slug("deploy:execute:staging"))).toBe(true)
		expect(result.has(slug("reports:export"))).toBe(true)
	})

	// -------------------------------------------------------------------------
	// Case 3 — overlapping permissions across multiple roles
	//
	// The DB query uses SELECT DISTINCT so duplicates are removed before
	// the array is returned. This test verifies that even if duplicates
	// slipped through (e.g. in a future query change), the Set still
	// deduplicates correctly — the contract holds at both layers.
	// -------------------------------------------------------------------------
	it("deduplicates overlapping permissions across roles", async () => {
		const roleRepo = makeRoleRepo([
			"billing:read", // held by role A
			"billing:read", // also held by role B — duplicate
			"billing:export", // held by role B only
		])
		const service = makeService(roleRepo)

		const result = await service.flattenPermissions(PRINCIPAL_ID, TENANT_ID)

		// Regardless of duplicates in the input, the Set has only unique slugs.
		expect(result.size).toBe(2)
		expect(result.has(slug("billing:read"))).toBe(true)
		expect(result.has(slug("billing:export"))).toBe(true)
	})

	// -------------------------------------------------------------------------
	// Case 4 — principal has no roles (or roles have no permissions)
	// -------------------------------------------------------------------------
	it("returns an empty Set when the principal holds no permissions", async () => {
		const roleRepo = makeRoleRepo([]) // DB returns nothing
		const service = makeService(roleRepo)

		const result = await service.flattenPermissions(PRINCIPAL_ID, TENANT_ID)

		expect(result).toBeInstanceOf(Set)
		expect(result.size).toBe(0)
	})

	// -------------------------------------------------------------------------
	// Case 5 — argument order guard
	//
	// The public signature is flattenPermissions(principalId, tenantId).
	// Verify the repository is called with (tenantId, principalId) — the
	// repository convention — not the other way around.
	// This test catches argument-order bugs which TypeScript cannot catch
	// because both arguments are the same base type (branded string).
	// -------------------------------------------------------------------------
	it("passes tenantId and principalId to the repository in the correct order", async () => {
		const otherTenantId = "ten_other" as TenantId
		const otherPrincipalId = "pri_other" as PrincipalId

		const roleRepo = makeRoleRepo([])
		const service = makeService(roleRepo)

		await service.flattenPermissions(otherPrincipalId, otherTenantId)

		// Repository signature: getFlatPermissionSlugs(tenantId, principalId)
		expect(roleRepo.getFlatPermissionSlugs).toHaveBeenCalledWith(otherTenantId, otherPrincipalId)
	})
})
