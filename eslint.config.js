import stylistic from "@stylistic/eslint-plugin";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["out/**", "dist/**", "build/**", "node_modules/**"],
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
