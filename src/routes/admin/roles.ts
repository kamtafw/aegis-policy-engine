// admin API routes for role and permission management
//
// endpoints:
//   POST /admin/tenants/:tenantId/roles
//   POST /admin/tenants/:tenantId/permissions
//   POST /admin/tenants/:tenantId/roles/:roleId/permissions   — assign permission to role
//   POST /admin/tenants/:tenantId/principals/:principalId/roles — assign role to principal
//
// ZOD VALIDATION:
//   All request bodies validated at this boundary.
//   The action field is validated against the closed vocabulary (AD-T-02).
//   The slug is not accepted as input — it is computed by the DB.
//
// VERSION COUNTERS:
//   Route handlers do not touch version counters.
//   AccessControlService owns all increments (AD-P-07).

import { z, ZodError } from "zod"
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify"
import type { AccessControlService } from "@core/management/access-control/AccessControlService"
import type { TenantRegistryService } from "@core/management/tenant-registry/TenantRegistryService"
import type { TenantId, RoleId, PrincipalId, PermissionId } from "@core/domain"
import { NotFoundError } from "@core/management/access-control/AccessControlService"
import { VALID_ACTIONS } from "@core/domain"

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CreateRoleBody = z.object({
	name: z.string().min(1, "Name is required").max(255, "Name must be 255 characters or fewer"),
})

const CreatePermissionBody = z.object({
	resource: z
		.string()
		.min(1, "Resource is required")
		.max(100)
		.regex(/^[a-z0-9-]+$/, "Resource must be lowercase alphanumeric with hyphens"),

	// validates against the closed vocabulary at the HTTP boundary (AD-T-02);
	// adding a new action word requires changing this enum — that's deliberate
	action: z.enum([...VALID_ACTIONS] as [string, ...string[]], {
		errorMap: () => ({ message: `Action must be one of: ${[...VALID_ACTIONS].join(", ")}` }),
	}),

	// optional — narrows scope: "staging", "restricted", etc.
	specificity: z
		.string()
		.max(100)
		.regex(/^[a-z0-9-]+$/, "Specificity must be lowercase alphanumeric with hyphens")
		.nullable()
		.optional()
		.transform((v) => v ?? null),
})

const AssignPermissionBody = z.object({
	permissionId: z.string().min(1, "permissionId is required"),
})

const AssignRoleBody = z.object({
	roleId: z.string().min(1, "roleId is required"),
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
	return typeof err === "object" && err !== null && "code" in err && err.code === "23505"
}

// ---------------------------------------------------------------------------
// Route plugin factory
// ---------------------------------------------------------------------------

export function adminRoleRoutes(
	tenantRegistry: TenantRegistryService,
	accessControl: AccessControlService,
): FastifyPluginAsync {
	return async function (server) {
		// shared tenant existence check — used by every endpoint in this file
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
		// POST /admin/tenants/:tenantId/roles
		// -----------------------------------------------------------------------
		server.post(
			"/admin/tenants/:tenantId/roles",
			async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
				const tenantId = request.params.tenantId as TenantId
				if (!(await requireTenant(tenantId, reply))) return

				let body: z.infer<typeof CreateRoleBody>
				try {
					body = CreateRoleBody.parse(request.body)
				} catch (err) {
					if (err instanceof ZodError) return reply.code(400).send(zodErrorResponse(err))
					throw err
				}

				try {
					const role = await accessControl.createRole(tenantId, body)
					return reply.code(201).send(role)
				} catch (err) {
					if (isUniqueViolation(err)) {
						return reply.code(409).send({
							error: "Conflict",
							message: `A role named '${body.name}' already exists in this tenant`,
						})
					}
					throw err
				}
			},
		)

		// -----------------------------------------------------------------------
		// POST /admin/tenants/:tenantId/permissions
		// -----------------------------------------------------------------------
		server.post(
			"/admin/tenants/:tenantId/permissions",
			async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
				const tenantId = request.params.tenantId as TenantId
				if (!(await requireTenant(tenantId, reply))) return

				let body: z.infer<typeof CreatePermissionBody>
				try {
					body = CreatePermissionBody.parse(request.body)
				} catch (err) {
					if (err instanceof ZodError) return reply.code(400).send(zodErrorResponse(err))
					throw err
				}

				try {
					const permission = await accessControl.createPermission(tenantId, {
						resource: body.resource,
						action: body.action as import("@core/domain/Permission.js").ValidAction,
						specificity: body.specificity ?? null,
					})
					return reply.code(201).send(permission)
				} catch (err) {
					if (isUniqueViolation(err)) {
						const slug = body.specificity
							? `${body.resource}:${body.action}:${body.specificity}`
							: `${body.resource}:${body.action}`
						return reply.code(409).send({
							error: "Conflict",
							message: `Permission '${slug}' already exists in this tenant`,
						})
					}
					throw err
				}
			},
		)

		// -----------------------------------------------------------------------
		// POST /admin/tenants/:tenantId/roles/:roleId/permissions
		// assign a permission to a role
		// -----------------------------------------------------------------------
		server.post(
			"/admin/tenants/:tenantId/roles/:roleId/permissions",
			async (
				request: FastifyRequest<{ Params: { tenantId: string; roleId: string } }>,
				reply: FastifyReply,
			) => {
				const tenantId = request.params.tenantId as TenantId
				const roleId = request.params.roleId as RoleId
				if (!(await requireTenant(tenantId, reply))) return

				let body: z.infer<typeof AssignPermissionBody>
				try {
					body = AssignPermissionBody.parse(request.body)
				} catch (err) {
					if (err instanceof ZodError) return reply.code(400).send(zodErrorResponse(err))
					throw err
				}

				try {
					await accessControl.assignPermissionToRole(
						tenantId,
						roleId,
						body.permissionId as PermissionId,
					)
					return reply.code(204).send()
				} catch (err) {
					if (err instanceof NotFoundError) {
						return reply.code(404).send({ error: "Not Found", message: err.message })
					}
					throw err
				}
			},
		)

		// -----------------------------------------------------------------------
		// POST /admin/tenants/:tenantId/principals/:principalId/roles
		// assign a role to a principal
		// -----------------------------------------------------------------------
		server.post(
			"/admin/tenants/:tenantId/principals/:principalId/roles",
			async (
				request: FastifyRequest<{ Params: { tenantId: string; principalId: string } }>,
				reply: FastifyReply,
			) => {
				const tenantId = request.params.tenantId as TenantId
				const principalId = request.params.principalId as PrincipalId
				if (!(await requireTenant(tenantId, reply))) return

				let body: z.infer<typeof AssignRoleBody>
				try {
					body = AssignRoleBody.parse(request.body)
				} catch (err) {
					if (err instanceof ZodError) return reply.code(400).send(zodErrorResponse(err))
					throw err
				}

				try {
					await accessControl.assignRoleToPrincipal(tenantId, principalId, body.roleId as RoleId)
					return reply.code(204).send()
				} catch (err) {
					if (err instanceof NotFoundError) {
						return reply.code(404).send({ error: "Not Found", message: err.message })
					}
					throw err
				}
			},
		)
	}
}
