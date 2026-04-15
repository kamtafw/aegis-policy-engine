/**
 * Config — validated at startup.
 * 
 * All environment access is centralized in this file. Nothing else in the codebase
 * reads process.env directly. If a required variable is missing, the process
 * exits before accepting any traffic.
 *
 * This is not a port — it's a startup concern. Config values are injected
 * into services and adapters via constructor arguments.
 */

function requiredEnv(key: string): string {
	const value = process.env[key]
	if (!value) {
		console.error(`[config] Missing required environment variable: ${key}`)
		process.exit(1)
	}
	return value
}

function optionalEnv(key: string, fallback: string): string {
	return process.env[key] ?? fallback
}

export const config = {
	server: {
		port: parseInt(optionalEnv("PORT", "3000"), 10),
		host: optionalEnv("HOST", "0.0.0.0"),
		nodeEnv: optionalEnv("NODE_ENV", "development"),
	},
	database: {
		url: requiredEnv("DATABASE_URL"),
	},
	redis: {
		url: requiredEnv("REDIS_URL"),
	},
	logging: {
		level: optionalEnv("LOG_LEVEL", "info"),
	},
} as const

export type Config = typeof config
