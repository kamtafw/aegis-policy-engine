/** @type {import('eslint').Linter.Config} */
export default {
	root: true,
	parser: "@typescript-eslint/parser",
	parserOptions: {
		ecmaVersion: "latest",
		sourceType: "module",
		project: "./tsconfig.json",
	},
	plugins: ["@typescript-eslint", "import"],
	extends: [
		"eslint:recommended",
		"plugin:@typescript-eslint/recommended-type-checked",
		"plugin:@typescript-eslint/stylistic-type-checked",
	],
	rules: {
		// -------------------------------------------------------------------------
		// plane dependency rules (AD-C-08)
		// each restriction carries the AD reference in the message so the developer
		// understands WHY the import is forbidden, not just that it is.
		// -------------------------------------------------------------------------
		"import/no-restricted-paths": [
			"error",
			{
				zones: [
					// Rule 1 — Core never imports from adapters
					// "Adapters implement ports. Core defines them. The arrow never reverses."
					{
						target: "./src/core",
						from: "./src/adapters",
						message:
							"[AD-C-08 Rule 1] Core cannot import from adapters. " +
							"Core defines port interfaces. Adapters implement them. " +
							"If you need infrastructure here, define a port in src/core/ports/ instead.",
					},

					// Rule 2 — Runtime never calls Management
					// "Runtime reads projections. It does not call mutation logic."
					{
						target: "./src/core/runtime",
						from: "./src/core/management",
						message:
							"[AD-C-08 Rule 2] Runtime plane cannot import from Management plane. " +
							"Runtime reads precomputed projections from Infrastructure (via ports). " +
							"It never calls Management write logic. " +
							"If you need data at request time, it must be in a cache or DB — not fetched via Management.",
					},

					// Rule 3 — Management never calls Runtime
					// "Management configures. Runtime enforces. The planes do not cross-call."
					{
						target: "./src/core/management",
						from: "./src/core/runtime",
						message:
							"[AD-C-08 Rule 3] Management plane cannot import from Runtime plane. " +
							"Management handles config changes and writes to Infrastructure. " +
							"It never invokes Runtime components. " +
							"Data flows through Infrastructure only.",
					},

					// Rule 4 — Adapters do not cross-import each other
					// "Each adapter is independently swappable. Cross-adapter coupling breaks that."
					{
						target: "./src/adapters",
						from: "./src/adapters",
						message:
							"[AD-C-08 Rule 4] Adapters cannot import from other adapters. " +
							"Each adapter is independently swappable. " +
							"If two adapters share logic, extract it to a port or a shared utility in core/.",
					},

					// Rule 5 — PolicyEngine must remain a pure function (AD-S-06)
					// The most critical constraint — any I/O in PolicyEngine breaks auditability.
					{
						target: "./src/core/runtime/PolicyEngine.ts",
						from: "./src/core/ports",
						message:
							"[AD-S-06 + AD-C-08] PolicyEngine is a pure function. " +
							"It cannot import ports or touch infrastructure in any form. " +
							"All data must be passed in as arguments. " +
							"evaluate(policy, permissions) → Decision. Nothing else.",
					},
				],
			},
		],

		"@typescript-eslint/no-explicit-any": "error",
		"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
		"@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
		"@typescript-eslint/no-floating-promises": "error",
		"@typescript-eslint/no-misused-promises": "error",
		"@typescript-eslint/await-thenable": "error",
		"@typescript-eslint/require-await": "error",
		"@typescript-eslint/no-unnecessary-type-assertion": "error",
		"@typescript-eslint/prefer-nullish-coalescing": "error",
		"@typescript-eslint/prefer-optional-chain": "error",
	},
	ignorePatterns: ["dist/", "node_modules/", "*.js", "*.cjs"],
}
