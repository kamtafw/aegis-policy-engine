import { execSync, spawn } from "child_process"

function run(cmd: string) {
	console.log(`\n▶ ${cmd}\n`)
	execSync(cmd, { stdio: "inherit" })
}

async function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms))
}

async function waitForPostgres() {
	console.log("⏳ Waiting for Postgres...")

	for (let i = 0; i < 20; i++) {
		try {
			execSync("docker exec aegis-policy-engine-postgres-1 pg_isready -U aegis", {
				stdio: "ignore",
			})
			console.log("✅ Postgres is ready")
			return
		} catch {
			await sleep(1000)
		}
	}

	throw new Error("Postgres never became ready")
}

async function main() {
	try {
		// 1. start docker stack
		run("docker compose up -d")

		// 2. wait for DB
		await waitForPostgres()

		// 3. run migrations
		run(`
docker run --rm \
  --network aegis-policy-engine_default \
  -v "$PWD":/app \
  -w /app \
  -e PGHOST=postgres \
  -e DATABASE_URL=postgres://aegis:aegis_dev@postgres:5432/aegis \
  node:20 \
  bash -c "npm install -g pnpm && pnpm migrate:up"
`)

		// 4. start backend
		console.log("🚀 Starting backend...\n")

		spawn("pnpm", ["dev:server"], {
			stdio: "inherit",
			shell: true,
		})
	} catch (err) {
		console.error(err)
		process.exit(1)
	}
}

main()
