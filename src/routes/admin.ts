// admin API routes for tenant and principal management.
//
// endpoints:
//   POST /admin/tenants                              — create a tenant
//   POST /admin/tenants/:tenantId/principals         — create a principal
//   GET  /admin/tenants/:tenantId/principals         — list principals
//
// ZOD VALIDATION (AD-C-07):
//   all request bodies are validated with Zod at this boundary;
//   validation errors return 400 with a structured message;
//   Zod never appears inside core services or domain types
//
// ERROR HANDLING:
//   postgres unique constraint violations (code 23505) → 409 Conflict;
//   unknown errors are re-thrown and handled by Fastify's error handler
//
// TENANT ISOLATION (AD-S-01):
//   every principal endpoint takes :tenantId from the URL;
//   the service and repository both receive it as a non-optional parameter;
//   a request for /admin/tenants/ten_A/principals cannot return principals
//   from ten_B — the query is structurally scoped

import { z, ZodError } from "zod"
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify"
import type { TenantRegistryService } from "@core/management/tenant-registry/TenantRegistryService"
import type { AccessControlService } from "@core/management/access-control/AccessControlService"
import type { TenantId } from "@core/domain"

// ---------------------------------------------------------------------------
// Zod schemas — validated at the HTTP boundary, not inside core
// ---------------------------------------------------------------------------

const CreateTenantBody = z.object({
	slug: z
		.string()
		.min(2, "Slug must be at least 2 characters")
		.max(63, "Slug must be 63 characters or fewer")
		.regex(
			/^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
			"Slug must be lowercase alphanumeric with hyphens, cannot start or end with a hyphen",
		),
	name: z.string().min(1, "Name is required").max(255, "Name must be 255 characters or fewer"),
	// PEM format validation would require parsing the key — deferred to IdentityService
	// at validation time. Here we just ensure it's a non-empty string.
	publicKey: z
		.string()
		.min(1, "Public key is required")
		.startsWith("-----BEGIN", "Public key must be in PEM format"),
	planTier: z.enum(["free", "pro", "enterprise"]).optional().default("free"),
})

const CreatePrincipalBody = z.object({
	externalId: z
		.string()
		.min(1, "externalId is required")
		.max(255, "externalId must be 255 characters or fewer"),
	metadata: z.record(z.unknown()).optional().default({}),
})

// ---------------------------------------------------------------------------
// Helper: detect Postgres unique constraint violation
// ---------------------------------------------------------------------------
function isUniqueViolation(err: unknown): boolean {
	return typeof err === "object" && err !== null && "code" in err && err.code === "23505"
}

// ---------------------------------------------------------------------------
// Helper: parse Zod errors into a readable 400 response body
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

// ---------------------------------------------------------------------------
// Route plugin factory
// Takes services as dependencies — wired in server.ts at the composition root.
// ---------------------------------------------------------------------------
export function adminTenantRoutes(
	tenantRegistry: TenantRegistryService,
	accessControl: AccessControlService,
): FastifyPluginAsync {
	return async function (server) {

		// -----------------------------------------------------------------------
		// POST /admin/tenants
		// -----------------------------------------------------------------------
		server.post("/admin/tenants", async (request: FastifyRequest, reply: FastifyReply) => {
			let body: z.infer<typeof CreateTenantBody>

			try {
				body = CreateTenantBody.parse(request.body)
			} catch (err) {
				if (err instanceof ZodError) {
					return reply.code(400).send(zodErrorResponse(err))
				}
				throw err
			}

			try {
				const tenant = await tenantRegistry.createTenant(body)
				return reply.code(201).send(tenant)
			} catch (err) {
				if (isUniqueViolation(err)) {
					return reply.code(409).send({
						error: "Conflict",
						message: `A tenant with slug '${body.slug}' already exists`,
					})
				}
				throw err
			}
		})

		// -----------------------------------------------------------------------
		// POST /admin/tenants/:tenantId/principals
		// -----------------------------------------------------------------------
		server.post(
			"/admin/tenants/:tenantId/principals",
			async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
				const tenantId = request.params.tenantId as TenantId

				// verify the tenant exists before creating a principal under it.
				const tenant = await tenantRegistry.getTenantById(tenantId)
				if (!tenant) {
					return reply.code(404).send({
						error: "Not Found",
						message: `Tenant '${tenantId}' not found`,
					})
				}

				let body: z.infer<typeof CreatePrincipalBody>

				try {
					body = CreatePrincipalBody.parse(request.body)
				} catch (err) {
					if (err instanceof ZodError) {
						return reply.code(400).send(zodErrorResponse(err))
					}
					throw err
				}

				try {
					const principal = await accessControl.createPrincipal(tenantId, body)
					return reply.code(201).send(principal)
				} catch (err) {
					if (isUniqueViolation(err)) {
						return reply.code(409).send({
							error: "Conflict",
							message: `A principal with externalId '${body.externalId}' already exists in this tenant`,
						})
					}
					throw err
				}
			},
		)

		// -----------------------------------------------------------------------
		// GET /admin/tenants/:tenantId/principals
		// -----------------------------------------------------------------------
		server.get(
			"/admin/tenants/:tenantId/principals",
			async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
				const tenantId = request.params.tenantId as TenantId

				// verify tenant exists — a 404 here is more informative than an empty list
				// which could be confused with "tenant exists but has no principals".
				const tenant = await tenantRegistry.getTenantById(tenantId)
				if (!tenant) {
					return reply.code(404).send({
						error: "Not Found",
						message: `Tenant '${tenantId}' not found`,
					})
				}

				const principals = await accessControl.listPrincipals(tenantId)

				return reply.code(200).send({
					data: principals,
					count: principals.length,
				})
			},
		)
	}
}
