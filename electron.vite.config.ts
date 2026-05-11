import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: { index: resolve(__dirname, "src/main/index.ts") },
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			rollupOptions: {
				input: { index: resolve(__dirname, "src/preload/index.ts") },
			},
		},
	},
	renderer: {
		root: resolve(__dirname, "src/renderer"),
		resolve: {
			alias: {
				"@renderer": resolve(__dirname, "src/renderer/src"),
				"@shared": resolve(__dirname, "src/shared"),
			},
		},
		define: {
			__APP_VERSION__: JSON.stringify(pkg.version),
		},
		build: {
			minify: "esbuild",
			cssMinify: true,
			rollupOptions: {
				input: resolve(__dirname, "src/renderer/index.html"),
			},
		},
		plugins: [react()],
	},
});
