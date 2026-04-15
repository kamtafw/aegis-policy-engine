// Permission — a capability that can be assigned to a role
//
// permissions are expressed as slugs: resource:action[:specificity] (AD-T-01)
// the action vocabulary is closed — new verbs are a deliberate schema event (AD-T-02)
//
// SLUG VALIDATION NOTE:
//   validation of slugs happens at write time (adapter boundary, via Zod) —
//   not at evaluation time; PolicyEngine receives pre-validated slugs
//   the VALID_ACTIONS set below is the source of truth for the closed vocabulary

import type { TenantId, PermissionId, PermissionSlug } from "./ids"

// the closed action vocabulary (AD-T-02)
// adding a word here is a deliberate schema event, not a naming preference
export const VALID_ACTIONS = new Set([
	"read",
	"write",
	"delete",
	"execute",
	"approve",
	"export",
	"administer",
] as const)

export type ValidAction =
	| "read"
	| "write"
	| "delete"
	| "execute"
	| "approve"
	| "export"
	| "administer"

export interface Permission {
	readonly id: PermissionId
	readonly tenantId: TenantId
	readonly resource: string
	readonly action: ValidAction
	readonly specificity:
		| string
		| null /** optional — narrows scope within a resource (e.g. "staging", "restricted") */
	readonly slug: PermissionSlug /** computed from resource + action + specificity at write time */
}

/**
 * validate a permission slug against the structural rules (AD-T-01, AD-T-02)
 * returns true if valid, false otherwise
 *
 * valid: "billing:read", "deploy:execute:staging", "users:administer"
 * invalid: "billing", "billing:view", "deploy:execute:staging:extra"
 *
 * called at adapter boundaries (Zod refinements) — never inside core evaluation
 */
export function isValidPermissionSlug(slug: string): boolean {
	const parts = slug.split(":")
	if (parts.length < 2 || parts.length > 3) return false

	const [resource, action, specificity] = parts
	if (!resource || resource.length === 0) return false
	if (!VALID_ACTIONS.has(action as ValidAction)) return false
	if (parts.length === 3 && (!specificity || specificity.length === 0)) return false

	const segmentPattern = /^[a-z0-9-]+$/
	return parts.every((p) => p !== undefined && segmentPattern.test(p))
}

/**
 * build a permission slug from its components
 * used by AccessControl when creating permissions
 */
export function buildPermissionSlug(
	resource: string,
	action: ValidAction,
	specificity?: string | null,
): PermissionSlug {
	const slug = specificity ? `${resource}:${action}:${specificity}` : `${resource}:${action}`
	return slug as PermissionSlug
}
