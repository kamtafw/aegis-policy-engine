/**
 * server.ts — Entry point
 *
 * Responsibilities:
 *
 *  1. Validate config (fails fast if env is missing)
 *  2. Initialize infrastructure connections (Postgres, Redis)
 *  3. Register Fastify plugins and routes
 *  4. Start listening for incoming requests
 *
 * This file wires adapters to the server. It does NOT contain any business logic.
 * The folder structure is the architecture — this file is just the assembly point.
 */

import Fastify from "fastify"
import { config } from "./config"

const server = Fastify({
	logger: {
		level: config.logging.level,
		// in production, use pino-pretty only in dev
		transport:
			config.server.nodeEnv === "development"
				? { target: "pino-pretty", options: { colorize: true } }
				: undefined,
	},
})

/**
 * Health check — infrastructure liveness only.
 *
 * Returns 200 if the server is up and accepting connections.
 * Does not check DB or Redis — those are readiness concerns handled separately.
 * Kept intentionally minimal: this route must never fail closed.
 */
server.get("/health", async (_request, reply) => {
	return reply.status(200).send({
		status: "ok",
		service: "aegis",
		timeStamp: new Date().toISOString(),
	})
})

/**
 * Readiness check — verifies infrastructure connectivity.
 *
 * Used by orchestrators (K8s, Docker) to determine if the pod should
 * receive traffic. Fails if Postgres or Redis are unreachable.
 *
 * Separated from /health to allow liveness probes to succeed even
 * when dependencies are temporarily unreachable during restarts.
 */
server.get("/ready", async (_request, reply) => {
	// TODO: wire real DB/Redis checks
	return reply.status(200).send({
		status: "ok",
		checks: {
			postgres: "not_yet_wired",
			redis: "not_yet_wired",
		},
	})
})

/**
 * Graceful shutdown — allow in-flight requests to complete.
 * Critical for the audit buffer: process must not be killed
 * while an AuditRecord write is in progress.
 */
const shutdown = async (signal: string): Promise<void> => {
	server.log.info({ signal }, "Received shutdown signal, closing server...")
	await server.close()
	server.log.info("Server closed. Exiting.")
	process.exit(0)
}

process.on("SIGTERM", () => {
	void shutdown("SIGTERM")
})

process.on("SIGINT", () => {
	void shutdown("SIGINT")
})

/**
 * Boot sequence.
 */
const start = async (): Promise<void> => {
	try {
		await server.listen({
			port: config.server.port,
			host: config.server.host,
		})
	} catch (err) {
		server.log.error(err, "Failed to start server")
		process.exit(1)
	}
}

void start()

export { server }
