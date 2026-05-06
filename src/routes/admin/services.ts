// admin API routes for service and route management
//
// endpoints:
//   POST /admin/tenants/:tenantId/services
//   POST /admin/tenants/:tenantId/services/:serviceId/routes
//   GET  /admin/tenants/:tenantId/services/:serviceId/routes

import type { PolicyId, ServiceId, TenantId } from "@core/domain"
import {
	NotFoundError,
	type ServiceRegistryService,
} from "@core/management/service-registry/ServiceRegistryService"
import type { TenantRegistryService } from "@core/management/tenant-registry/TenantRegistryService"
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify"
import { z, ZodError } from "zod"

const CreateServiceBody = z.object({
	name: z.string().min(1, "name is required").max(255),
	upstreamUrl: z.string().url("upstreamUrl must be a valid URL"),
})

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const

const CreateRouteBody = z.object({
	method: z.enum(HTTP_METHODS, {
		errorMap: () => ({ message: `method must be one of: ${HTTP_METHODS.join(", ")}` }),
	}),
	pathPattern: z
		.string()
		.min(1, "pathPattern is required")
		.startsWith("/", "pathPattern must start with /"),
	// optional — null means no policy (route always denies until one is assigned, AD-S-07).
	policyId: z
		.string()
		.min(1)
		.nullable()
		.optional()
		.transform((v) => v ?? null),
})

function zodErrorResponse(err: ZodError) {
	return {
		error: "Validation Error",
		message: "Request body is invalid",
		issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
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

export function adminServiceRoutes(
	tenantRegistry: TenantRegistryService,
	serviceRegistry: ServiceRegistryService,
): FastifyPluginAsync {
	return async function (server) {
		async function requireTenant(tenantId: string, reply: FastifyReply) {
			const tenant = await tenantRegistry.getTenantById(tenantId as TenantId)
			if (!tenant) {
				await reply
					.code(404)
					.send({ error: "Not Found", message: `Tenant '${tenantId}' not found` })
				return null
			}
			return tenant
		}

		// POST /admin/tenants/:tenantId/services
		server.post(
			"/admin/tenants/:tenantId/services",
			async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
				const tenantId = request.params.tenantId as TenantId
				if (!(await requireTenant(tenantId, reply))) return

				let body: z.infer<typeof CreateServiceBody>
				try {
					body = CreateServiceBody.parse(request.body)
				} catch (err) {
					if (err instanceof ZodError) return reply.code(400).send(zodErrorResponse(err))
					throw err
				}

				try {
					const service = await serviceRegistry.createService(tenantId, body)
					return reply.code(201).send(service)
				} catch (err) {
					if (isUniqueViolation(err))
						return reply.code(409).send({
							error: "Conflict",
							message: `A service named '${body.name}' already exists in this tenant`,
						})
					throw err
				}
			},
		)

		// POST /admin/tenants/:tenantId/services/:serviceId/routes
		server.post(
			"/admin/tenants/:tenantId/services/:serviceId/routes",
			async (
				request: FastifyRequest<{ Params: { tenantId: string; serviceId: string } }>,
				reply: FastifyReply,
			) => {
				const tenantId = request.params.tenantId as TenantId
				const serviceId = request.params.serviceId as ServiceId
				if (!(await requireTenant(tenantId, reply))) return

				let body: z.infer<typeof CreateRouteBody>
				try {
					body = CreateRouteBody.parse(request.body)
				} catch (err) {
					if (err instanceof ZodError) return reply.code(400).send(zodErrorResponse(err))
					throw err
				}

				try {
					const route = await serviceRegistry.createRoute(tenantId, serviceId, {
						method: body.method,
						pathPattern: body.pathPattern,
						policyId: body.policyId as PolicyId | null,
					})
					return reply.code(201).send(route)
				} catch (err) {
					if (err instanceof NotFoundError)
						return reply.code(404).send({ error: "Not Found", message: err.message })
					if (isUniqueViolation(err))
						return reply.code(409).send({
							error: "Conflict",
							message: `Route ${body.method} ${body.pathPattern} already exists on this service`,
						})
					throw err
				}
			},
		)

		// GET /admin/tenants/:tenantId/services/:serviceId/routes
		server.get(
			"/admin/tenants/:tenantId/services/:serviceId/routes",
			async (
				request: FastifyRequest<{ Params: { tenantId: string; serviceId: string } }>,
				reply: FastifyReply,
			) => {
				const tenantId = request.params.tenantId as TenantId
				const serviceId = request.params.serviceId as ServiceId
				if (!(await requireTenant(tenantId, reply))) return

				try {
					const routes = await serviceRegistry.listRoutes(tenantId, serviceId)
					return reply.code(200).send({ data: routes, count: routes.length })
				} catch (err) {
					if (err instanceof NotFoundError)
						return reply.code(404).send({ error: "Not Found", message: err.message })
					throw err
				}
			},
		)
	}
}
