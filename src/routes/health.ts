// liveness and readiness probes.
//
// /health — liveness. No infrastructure checks. Must never fail closed.
// /ready  — readiness. Checks Postgres connectivity with a SELECT 1.
//           Returns 503 if the check fails so the load balancer stops routing traffic here.
//
// Redis check is left as "not_checked" until Day 12 when the Redis
// client is wired into the server.

import type { FastifyPluginAsync } from "fastify"
import type { Sql } from "@adapters/postgres/client"

// factory function — takes the postgres client so /ready can run a real check
export function healthRoutes(sql: Sql): FastifyPluginAsync {
	return async function (server) {
		server.get("/health", async (_request, reply) => {
			return reply.code(200).send({
				status: "ok",
				service: "aegis",
				time: new Date().toISOString(),
			})
		})

		server.get("/ready", async (_request, reply) => {
			// Postgres check — a failed SELECT 1 means the DB is unreachable
			let postgresStatus = "ok"
			try {
				await sql`SELECT 1`
			} catch {
				postgresStatus = "unreachable"
			}

			const healthy = postgresStatus === "ok"

			return reply.code(healthy ? 200 : 503).send({
				status: healthy ? "ok" : "degraded",
				postgres: postgresStatus,
				redis: "not_checked", // TODO: (Day 12): wire Redis PING
			})
		})
	}
}
