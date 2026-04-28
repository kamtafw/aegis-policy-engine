import { defineConfig } from "vitest/config"
import { resolve } from "path"

export default defineConfig({
	resolve: {
		alias: {
			"@core": resolve(__dirname, "src/core"),
			"@adapters": resolve(__dirname, "src/adapters"),
			"@domain": resolve(__dirname, "src/core/domain"),
			"@ports": resolve(__dirname, "src/core/ports"),
		},
	},
	test: {
		globals: false,
	},
})
