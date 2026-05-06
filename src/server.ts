// Aegis server entry point — assembly point only.
//
// its job is:
//   1. read environment configuration
//   2. instantiate infrastructure clients (Postgres, Redis)
//   3. instantiate adapters with those clients
//   4. instantiate core services with those adapters (dependency injection)
//   5. register routes
//   6. start listening
//
// No business logic lives here. No validation. No domain concepts.
// if writing an if-statement about a tenant or a policy here, it belongs in a service or adapter instead
//
// AD-C-08: this file sits outside the plane structure — it is the composition root
// it is the only place where adapters and core services are allowed to appear together

import Fastify from "fastify"
import crypto from "crypto"
import { createPostgresClient } from "@adapters/postgres/client"
import { TenantRepository } from "@adapters/postgres/TenantRepository"
import { PrincipalRepository } from "@adapters/postgres/PrincipalRepository"
import { RoleRepository } from "@adapters/postgres/RoleRepository"
import { PermissionRepository } from "@adapters/postgres/PermissionRepository"
import { TenantRegistryService } from "@core/management/tenant-registry/TenantRegistryService"
import { AccessControlService } from "@core/management/access-control/AccessControlService"
import { healthRoutes } from "./routes/health"
import { adminTenantRoutes } from "./routes/admin/tenants"
import { adminRoleRoutes } from "./routes/admin/roles"
import { PolicyRepository } from "@adapters/postgres/PolicyRepository"
import { PolicyRegistryService } from "@core/management/policy-registry/PolicyRegistryService"
import { adminPolicyRoutes } from "./routes/admin/policies"
import { ServiceRepository } from "@adapters/postgres/ServiceRepository"
import { ServiceRegistryService } from "@core/management/service-registry/ServiceRegistryService"
import { adminServiceRoutes } from "./routes/admin/services"

const HOST = process.env["HOST"] ?? "0.0.0.0"
const PORT = parseInt(process.env["PORT"] ?? "3000", 10)
const LOG_LEVEL = process.env["LOG_LEVEL"] ?? "info"

async function build() {
	const server = Fastify({
		logger: {
			level: LOG_LEVEL,
			// structured logging in production, pretty-print in development
			...(process.env["NODE_ENV"] !== "production" && {
				transport: {
					target: "pino-pretty",
					options: { colorize: true, translateTime: "HH:MM:ss Z" },
				},
			}),
		},
		// request ID generation — used in audit correlation
		genReqId: () => crypto.randomUUID(),
	})

	// -------------------------------------------------------------------------
	// Infrastructure clients: instantiated here, passed down — never imported directly by core services
	// -------------------------------------------------------------------------
	const sql = createPostgresClient()
	// TODO: (Day 5): Redis client (ioredis)

	// -------------------------------------------------------------------------
	// Repository adapters
	// -------------------------------------------------------------------------
	const tenantRepo = new TenantRepository(sql)
	const principalRepo = new PrincipalRepository(sql)
	const roleRepo = new RoleRepository(sql)
	const permissionRepo = new PermissionRepository(sql)
	const policyRepo = new PolicyRepository(sql)
	const serviceRepo = new ServiceRepository(sql)

	// TODO: (Day 12): RedisCacheAdapter
	// TODO: (Day 12): RedisAuditBufferAdapter
	// TODO: (Day 13): JwtValidatorAdapter
	// TODO: (Day 15): PolicyRepositoryAdapter
	// TODO: (Day 15): PrincipalProjectionAdapter

	// -------------------------------------------------------------------------
	// Core services
	// -------------------------------------------------------------------------
	const tenantRegistry = new TenantRegistryService(tenantRepo)
	const accessControl = new AccessControlService(
		principalRepo,
		tenantRepo,
		roleRepo,
		permissionRepo,
	)
	const policyRegistry = new PolicyRegistryService(policyRepo, tenantRepo)
	const serviceRegistry = new ServiceRegistryService(serviceRepo)

	// TODO: (Day 13): IdentityService
	// TODO: (Day 14): PermissionResolver
	// TODO: (Day 16): EnforcementPipeline

	// -------------------------------------------------------------------------
	// Routes
	// -------------------------------------------------------------------------
	await server.register(healthRoutes(sql))
	await server.register(adminTenantRoutes(tenantRegistry, accessControl))
	await server.register(adminRoleRoutes(tenantRegistry, accessControl))
	await server.register(adminPolicyRoutes(tenantRegistry, policyRegistry))
	await server.register(adminServiceRoutes(tenantRegistry, serviceRegistry))

	// graceful shutdown — allow in-flight requests to complete
	// critical for the audit buffer: the process must not be killed while an
	// AuditRecord write is in progress (AD-S-08)
	const shutdown = async (signal: string) => {
		server.log.info({ signal }, "Shutdown signal received")
		await server.close()
		await sql.end()
		server.log.info("Server and DB connection closed")
		process.exit(0)
	}

	process.on("SIGTERM", () => void shutdown("SIGTERM"))
	process.on("SIGINT", () => void shutdown("SIGINT"))

	return server
}

async function start() {
	const server = await build()
	try {
		await server.listen({ host: HOST, port: PORT })
	} catch (err) {
		server.log.error(err)
		process.exit(1)
	}
}

await start()
