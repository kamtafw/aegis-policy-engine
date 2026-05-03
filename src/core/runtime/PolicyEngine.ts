// PolicyEngine — pure evaluation function (AD-S-06, AD-P-01, AD-P-04)
//
// THE MOST CRITICAL INVARIANT IN THIS FILE:
//   No imports from adapters/. No imports from ports/. No I/O of any kind.
//   Every input arrives as a parameter. Every output is the return value.
//   A wrong answer is always traceable to wrong input — never to this logic.
//
// The ESLint rule in eslint.config.js enforces this structurally:
//   [AD-S-06] PolicyEngine cannot import from core/ports/.
//
// SIGNATURE:
//   evaluate(policy, permissions, policyVersion, principalVersion) → Decision
//
//   The spec shorthand is evaluate(policy, permissions) → Decision.
//   The two version parameters are required because Decision carries them
//   for audit assembly. EnforcementPipeline passes them from PermissionContext.
//   The function remains pure — all inputs are explicit, no state is read.
//
// EVALUATION SEMANTICS:
//
//   ANY — short-circuit on first satisfied permission (AD-P-04)
//     If the principal holds any one of the required permissions → allow.
//     Stops at the first match. The reason names that permission.
//
//   ALL — short-circuit on first unsatisfied permission (AD-P-04)
//     The principal must hold every required permission → allow.
//     Stops at the first miss. The reason names that permission.
//
//   DELETED PERMISSIONS (AD-C-04)
//     A slug in policy.requiredPermissions may reference a permission that
//     has since been deleted. Deleted permissions are not in the principal's
//     flat set — they are simply unsatisfied. No special handling is needed;
//     the logic treats them identically to a permission the principal
//     was never assigned.
//
//   EMPTY requiredPermissions
//     The policy schema enforces min(1) at write time, so an empty array
//     should never arrive here from a valid policy. Defensively: deny.
//     Fail closed (AD-S-07) — ambiguity is never treated as permission.
//
// REASON STRINGS (AD-T-04):
//   Must be self-explanatory to a security engineer who did not build the system.
//   Every reason names the specific permission slug that decided the outcome.

import type { PermissionSlug } from "@core/domain"
import type { Policy } from "@core/ports"
import { Decision } from "./context"

export function evaluate(
	policy: Policy,
	permissions: ReadonlySet<PermissionSlug>,
	policyVersion: number,
	principalVersion: number,
): Decision {
	const base = {
		evaluatedPolicyVersion: policyVersion,
		evaluatedPrincipalVersion: principalVersion,
	}

	// defensive: empty requiredPermissions — deny (AD-S-07
	if (policy.requiredPermissions.length === 0) {
		return {
			...base,
			allowed: false,
			reason: "denied: policy has no required permissions configured",
		}
	}

	if (policy.matchStrategy === "ANY") {
		return evaluateAny(policy.requiredPermissions, permissions, base)
	}

	return evaluateAll(policy.requiredPermissions, permissions, base)
}

// ---------------------------------------------------------------------------
// ANY — allow on first match, deny if none match
// ---------------------------------------------------------------------------
function evaluateAny(
	required: PermissionSlug[],
	permissions: ReadonlySet<PermissionSlug>,
	base: { evaluatedPolicyVersion: number; evaluatedPrincipalVersion: number },
): Decision {
	for (const slug of required) {
		if (permissions.has(slug)) {
			// short-circuit: first satisfied permission decides
			return { ...base, allowed: true, reason: `allowed: holds ${slug}` }
		}
	}

	// no required permission was held — list all of them so the reason is
	// actionable: the operator can see exactly what needs to be granted
	const list = required.join(", ")
	return { ...base, allowed: false, reason: `denied: holds none of [${list}]` }
}

// ---------------------------------------------------------------------------
// ALL — deny on first miss, allow only if all are held
// ---------------------------------------------------------------------------
function evaluateAll(
	required: PermissionSlug[],
	permissions: ReadonlySet<PermissionSlug>,
	base: { evaluatedPolicyVersion: number; evaluatedPrincipalVersion: number },
): Decision {
	for (const slug of required) {
		if (!permissions.has(slug)) {
			// short-circuit: first unsatisfied permission decides.
			return {
				...base,
				allowed: false,
				reason: `denied: missing ${slug}`,
			}
		}
	}

	// every required permission was held.
	return {
		...base,
		allowed: true,
		reason: `allowed: holds all required permissions`,
	}
}
