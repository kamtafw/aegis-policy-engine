// liveness and readiness probes.
//
// /health — liveness: is the process alive? Used by container orchestrators to
//           decide whether to restart the container. Returns 200 if the server
//           is responsive. No infrastructure checks.
//
// /ready  — readiness: is the process ready to serve traffic? Used by load
//           balancers to decide whether to route requests here. Checks that
//           infrastructure dependencies (Postgres, Redis) are reachable.
//           Returns 503 if not ready — the orchestrator will stop sending traffic.
//
// These routes deliberately have no auth. They must be reachable before auth
// infrastructure is healthy — that's the point of a readiness probe.

import type { FastifyPluginAsync } from "fastify"

export const healthRoutes: FastifyPluginAsync = async (server) => {
	// liveness probe — process is alive
	server.get(
		"/health",
		{
			schema: {
				response: {
					200: {
						type: "object",
						properties: {
							status: { type: "string" },
							service: { type: "string" },
							time: { type: "string" },
						},
					},
				},
			},
		},
		async (_request, reply) => {
			return reply.code(200).send({
				status: "ok",
				service: "aegis",
				time: new Date().toISOString(),
			})
		},
	)

	// readiness probe — infrastructure is reachable
	// TODO: (Day 5): wire real Postgres + Redis health checks here;
	//                until then, returns degraded: true to signal partial readiness
	server.get(
		"/ready",
		{
			schema: {
				response: {
					200: {
						type: "object",
						properties: {
							status: { type: "string" },
							postgres: { type: "string" },
							redis: { type: "string" },
							degraded: { type: "boolean" },
						},
					},
					503: {
						type: "object",
						properties: {
							status: { type: "string" },
							reason: { type: "string" },
						},
					},
				},
			},
		},
		async (_request, reply) => {
			// TODO: (Day 5): replace with real infrastructure ping
			return reply.code(200).send({
				status: "ok",
				postgres: "not_checked",
				redis: "not_checked",
				degraded: true,
			})
		},
	)
}
