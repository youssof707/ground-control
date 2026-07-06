import stylistic from "@stylistic/eslint-plugin";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		// `.dev-store/**` covers the dev-only data dir where app-owned git
		// worktrees get carved out at runtime — the checked-out repos there
		// aren't ours to lint.
		ignores: [
			"out/**",
			"dist/**",
			"build/**",
			"node_modules/**",
			".dev-store/**",
		],
	},
	{
		files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
		languageOptions: {
			parser: tseslint.parser,
		},
		plugins: {
			"@stylistic": stylistic,
		},
		rules: {
			"@stylistic/indent": ["error", "tab"],
		},
	},
);
