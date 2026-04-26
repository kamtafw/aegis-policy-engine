// postgres.js client — the single connection pool for the application.
//
// created once in server.ts and injected into repository adapters.
// never imported directly by core services — core depends on ports, not this.
//
// plane: adapters — infrastructure concern, not visible to core.

import postgres from "postgres"

export type Sql = ReturnType<typeof postgres>

export function createPostgresClient(): Sql {
	const connectionString = process.env["DATABASE_URL"]

	if (!connectionString) {
		throw new Error(
			"DATABASE_URL is required. " +
				"Check your .env — PGHOST should be 'localhost' for the server process " +
				"(migrations use 'postgres' inside Docker via database.json).",
		)
	}

	return postgres(connectionString, {
		max: 10,
		idle_timeout: 30,
		connect_timeout: 10,
		// transform column names from snake_case (DB) to camelCase (JS).
		// this means DB row { tenant_id, public_key } becomes { tenantId, publicKey }.
		// keeps domain types clean without manual mapping on every query.
		transform: postgres.camel,
	})
}
