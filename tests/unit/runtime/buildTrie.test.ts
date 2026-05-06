// unit tests for buildTrie — pure function, no mocks needed

import { describe, it, expect } from "vitest"
import { buildTrie } from "@core/runtime/buildTrie"
import type { TrieRoute } from "@core/runtime/buildTrie"
import type { RouteId } from "@core/domain"

const id = (s: string) => s as RouteId

const route = (method: TrieRoute["method"], pathPattern: string, routeId: string): TrieRoute => {
	return { id: id(routeId), method, pathPattern }
}

describe("buildTrie", () => {
	it("returns a root node with no children for an empty route list", () => {
		const trie = buildTrie([])
		expect(trie.children.size).toBe(0)
		expect(trie.paramChild).toBeNull()
		expect(trie.routes.size).toBe(0)
	})

	it("registers a single static route at the correct node", () => {
		const trie = buildTrie([route("GET", "/health", "rte_1")])

		const health = trie.children.get("health")
		expect(health).toBeDefined()
		expect(health!.routes.get("GET")).toBe("rte_1")
	})

	it("registers a nested static route", () => {
		const trie = buildTrie([route("POST", "/admin/tenants", "rte_2")])

		const admin = trie.children.get("admin")
		const tenants = admin?.children.get("tenants")
		expect(tenants?.routes.get("POST")).toBe("rte_2")
	})

	it("registers a route with a path parameter", () => {
		const trie = buildTrie([route("GET", "/tenants/:tenantId", "rte_3")])

		const tenants = trie.children.get("tenants")
		expect(tenants).toBeDefined()
		expect(tenants!.paramChild).not.toBeNull()
		expect(tenants!.paramName).toBe("tenantId")
		expect(tenants!.paramChild!.routes.get("GET")).toBe("rte_3")
	})

	it("registers a route with multiple path parameters", () => {
		const trie = buildTrie([route("GET", "/tenants/:tenantId/principals/:principalId", "rte_4")])

		const tenants = trie.children.get("tenants")!
		const tenantNode = tenants.paramChild! // :tenantId
		const principals = tenantNode.children.get("principals")!
		const priNode = principals.paramChild! // :principalId

		expect(tenants.paramName).toBe("tenantId")
		expect(principals).toBeDefined()
		expect(priNode.routes.get("GET")).toBe("rte_4")
	})

	it("registers different methods on the same path as separate route IDs", () => {
		const trie = buildTrie([route("GET", "/users", "rte_get"), route("POST", "/users", "rte_post")])

		const users = trie.children.get("users")!
		expect(users.routes.get("GET")).toBe("rte_get")
		expect(users.routes.get("POST")).toBe("rte_post")
	})

	it("exact segment takes priority over param segment at the same depth", () => {
		// /users/me (exact) and /users/:userId (param) are both registered.
		// The exact child "me" should exist alongside paramChild.
		const trie = buildTrie([
			route("GET", "/users/me", "rte_me"),
			route("GET", "/users/:userId", "rte_user"),
		])

		const users = trie.children.get("users")!
		// Exact child for "me"
		expect(users.children.get("me")?.routes.get("GET")).toBe("rte_me")
		// Param child for :userId
		expect(users.paramChild?.routes.get("GET")).toBe("rte_user")
	})

	it("handles root path /", () => {
		const trie = buildTrie([route("GET", "/", "rte_root")])
		// Root path has no segments — the route is registered at the root node.
		expect(trie.routes.get("GET")).toBe("rte_root")
	})

	it("builds a trie with multiple unrelated routes correctly", () => {
		const routes: TrieRoute[] = [
			route("GET", "/health", "rte_health"),
			route("POST", "/admin/tenants", "rte_create_tenant"),
			route("GET", "/admin/tenants/:tenantId/roles", "rte_list_roles"),
			route("DELETE", "/admin/tenants/:tenantId/roles/:roleId", "rte_delete_role"),
		]

		const trie = buildTrie(routes)

		// /health
		expect(trie.children.get("health")!.routes.get("GET")).toBe("rte_health")

		// /admin/tenants
		const admin = trie.children.get("admin")!
		const tenants = admin.children.get("tenants")!
		expect(tenants.routes.get("POST")).toBe("rte_create_tenant")

		// /admin/tenants/:tenantId/roles
		const tenantNode = tenants.paramChild!
		const roles = tenantNode.children.get("roles")!
		expect(roles.routes.get("GET")).toBe("rte_list_roles")

		// /admin/tenants/:tenantId/roles/:roleId
		const roleNode = roles.paramChild!
		expect(roleNode.routes.get("DELETE")).toBe("rte_delete_role")
	})
})
