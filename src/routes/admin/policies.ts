// admin API routes for policy management
//
// Endpoints:
//   POST /admin/tenants/:tenantId/policies  — create a policy
//   GET  /admin/tenants/:tenantId/policies  — list all policies for a tenant
//
// VALIDATION (AD-C-01, AD-C-02):
//   requiredPermissions — validated as a non-empty string array where each
//   element passes isValidPermissionSlug(); invalid slugs are rejected
//   before the DB write; this is the structural enforcement of AD-C-02
//
//   matchStrategy — must be "ANY" or "ALL"; no other values accepted
//
//   context_version — NOT accepted from the caller; PolicyRegistryService
//   stamps it at write time; supplying it in the request body is ignored
//   (AD-C-03)
//
//   name — required, unique within tenant (enforced by DB constraint)

import { z, ZodError } from "zod"
import { isValidPermissionSlug } from "@core/domain"
import type { PermissionSlug, TenantId } from "@core/domain"
import type { TenantRegistryService } from "@core/management/tenant-registry/TenantRegistryService"
import type { PolicyRegistryService } from "@core/management/policy-registry/PolicyRegistryService"
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify"

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const CreatePolicyBody = z.object({
	name: z.string().min(1, "name is required").max(255, "name must be 255 characters or fewer"),

	// each element must pass the slug structural rules (AD-T-01, AD-T-02);
	// isValidPermissionSlug checks: resource:action[:specificity] format,
	// action is in the closed vocabulary, segments are lowercase alphanumeric
	//
	// we do NOT verify the slugs exist in the permissions table at this point;
	// AD-C-04 handles missing permissions at evaluation time (treated as unsatisfied);
	// requiring existence here would couple policy creation to permission existence,
	// making it impossible to create policies before permissions are defined
	requiredPermissions: z
		.array(
			z.string().refine(isValidPermissionSlug, (s) => ({
				message: `'${s}' is not a valid permission slug (expected resource:action[:specificity] with a closed-vocabulary action)`,
			})),
		)
		.min(1, "requiredPermissions must contain at least one slug"),

	matchStrategy: z.enum(["ANY", "ALL"], {
		errorMap: () => ({ message: "matchStrategy must be 'ANY' or 'ALL'" }),
	}),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function zodErrorResponse(err: ZodError) {
	return {
		error: "Validation Error",
		message: "Request body is invalid",
		issues: err.issues.map((i) => ({
			path: i.path.join("."),
			message: i.message,
		})),
	}
}

function isUniqueViolation(err: unknown): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		(err as { code: string }).code === "23505"
	)
}

// ---------------------------------------------------------------------------
// Route plugin factory
// ---------------------------------------------------------------------------
export function adminPolicyRoutes(
	tenantRegistry: TenantRegistryService,
	policyRegistry: PolicyRegistryService,
): FastifyPluginAsync {
	return async function (server) {
		async function requireTenant(tenantId: string, reply: FastifyReply) {
			const tenant = await tenantRegistry.getTenantById(tenantId as TenantId)
			if (!tenant) {
				await reply.code(404).send({
					error: "Not Found",
					message: `Tenant '${tenantId}' not found`,
				})
				return null
			}
			return tenant
		}

		// -----------------------------------------------------------------------
		// POST /admin/tenants/:tenantId/policies
		// -----------------------------------------------------------------------
		server.post(
			"/admin/tenants/:tenantId/policies",
			async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
				const tenantId = request.params.tenantId as TenantId
				if (!(await requireTenant(tenantId, reply))) return

				let body: z.infer<typeof CreatePolicyBody>
				try {
					body = CreatePolicyBody.parse(request.body)
				} catch (err) {
					if (err instanceof ZodError) return reply.code(400).send(zodErrorResponse(err))
					throw err
				}

				try {
					const policy = await policyRegistry.createPolicy(tenantId, {
						name: body.name,
						requiredPermissions: body.requiredPermissions as PermissionSlug[],
						matchStrategy: body.matchStrategy,
					})
					return reply.code(201).send(policy)
				} catch (err) {
					if (isUniqueViolation(err)) {
						return reply.code(409).send({
							error: "Conflict",
							message: `A policy named '${body.name}' already exists in this tenant`,
						})
					}
					throw err
				}
			},
		)

		// -----------------------------------------------------------------------
		// GET /admin/tenants/:tenantId/policies
		// -----------------------------------------------------------------------
		server.get(
			"/admin/tenants/:tenantId/policies",
			async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
				const tenantId = request.params.tenantId as TenantId
				if (!(await requireTenant(tenantId, reply))) return

				const policies = await policyRegistry.listPolicies(tenantId)
				return reply.code(200).send({ data: policies, count: policies.length })
			},
		)
	}
}
