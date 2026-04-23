// Aegis server entry point.
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
import { healthRoutes } from "./routes/health"

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
	// Infrastructure clients
	// instantiated here, passed down — never imported directly by core services
	// -------------------------------------------------------------------------
	// TODO: (Day 5): Postgres client (postgres.js)
	// TODO: (Day 5): Redis client (ioredis)

	// -------------------------------------------------------------------------
	// Adapters
	// -------------------------------------------------------------------------
	// TODO: (Day 5): TenantRepositoryAdapter
	// TODO: (Day 5): PrincipalRepositoryAdapter
	// TODO: (Day 12): RedisCacheAdapter
	// TODO: (Day 12): RedisAuditBufferAdapter
	// TODO: (Day 15): PolicyRepositoryAdapter
	// TODO: (Day 15): PrincipalProjectionAdapter
	// TODO: (Day 13): JwtValidatorAdapter

	// -------------------------------------------------------------------------
	// Core services
	// -------------------------------------------------------------------------
	// TODO: (Day 5): TenantRegistryService
	// TODO: (Day 5): AccessControlService
	// TODO: (Day 13): IdentityService
	// TODO: (Day 14): PermissionResolver
	// TODO: (Day 16): EnforcementPipeline

	// -------------------------------------------------------------------------
	// Routes
	// -------------------------------------------------------------------------
	await server.register(healthRoutes)
	// TODO: (Day 5): Admin routes (tenants, principals)

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
