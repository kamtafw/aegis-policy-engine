// prefix trie builder for route matching (AD-P-05)
//
// NOT wired to the gateway yet — that happens on Day 18 when HttpAdapter
// is built; this file defines the data structure and the builder function;
// Day 18 will add matchTrie(trie, method, path) → RouteMatch | null
//
// WHY A TRIE (AD-P-05):
//   linear scanning across all routes on every request is not acceptable;
//   a prefix trie gives O(depth) lookup where depth = number of path segments;
//   the trie is built once at startup and rebuilt on SIGHUP or config reload
//
// PATH SEGMENT TYPES:
//   Exact   — "users", "orders", "admin"  → matched literally
//   Param   — ":userId", ":orderId"       → matched by any segment, name captured
//
//   exact segments take priority over param segments at the same depth;
//   this means /users/me matches the exact "me" node before the :userId param
//
// METHODS:
//   each trie leaf stores a method map: HttpMethod → RouteId;
//   a path may have different routes for GET vs POST — both live at the
//   same path node but under different method keys
//
// plane: core/runtime — no I/O, no imports from adapters;
// this function is pure: same routes in → same trie out

import { RouteId } from "@core/domain"

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"

// ---------------------------------------------------------------------------
// Trie data structure
// ---------------------------------------------------------------------------

export interface TrieNode {
	children: Map<string, TrieNode> // exact segment matches: "users" → child node
	paramChild: TrieNode | null // parameter segment match: "userId" → child node (only one per level)
	paramName: string | null // name of the parameter at this node, e.g. "userId" for ":userId"
	routes: Map<HttpMethod, RouteId> // route IDs registered at this path depth, keyed by HTTP method
}

// returned by matchTrie (implemented Day 18) — exported here so the type
// is available to callers before the matcher exists
export interface RouteMatch {
	routeId: RouteId
	params: Record<string, string> // extracted path parameters
}

// minimal route shape the builder needs — avoids importing the full
// ServiceRepository type into the runtime plane
export interface TrieRoute {
	id: RouteId
	method: HttpMethod
	pathPattern: string // e.g. "/users/:userId/orders/:orderId"
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function makeNode(): TrieNode {
	return {
		children: new Map(),
		paramChild: null,
		paramName: null,
		routes: new Map(),
	}
}

export function buildTrie(routes: TrieRoute[]): TrieNode {
	const root = makeNode()

	for (const route of routes) {
		insertRoute(root, route)
	}

	return root
}

function insertRoute(root: TrieNode, route: TrieRoute): void {
	// normalise: strip leading slash, split into segments;
	// "/users/:userId/orders" → ["users", ":userId", "orders"]
	const raw = route.pathPattern.startsWith("/") ? route.pathPattern.slice(1) : route.pathPattern
	const segments = raw === "" ? [] : raw.split("/")

	let node = root

	for (const segment of segments) {
		if (segment.startsWith(":")) {
			// parameter segment
			const paramName = segment.slice(1) // strip leading ":"
			if (!node.paramChild) {
				node.paramChild = makeNode()
				node.paramName = paramName
			}
			node = node.paramChild
		} else {
			// exact segment
			if (!node.children.has(segment)) {
				node.children.set(segment, makeNode())
			}
			node = node.children.get(segment)!
		}
	}

	// register the route at this leaf node;
	// if the same method + path already exists, last write wins —
	// duplicate registration is a configuration error caught at the
	// DB level via the unique constraint (service_id, method, path_pattern)
	node.routes.set(route.method, route.id)
}
