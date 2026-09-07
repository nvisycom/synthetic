import { defineConfig } from "tsdown";

export default defineConfig({
	// Entry and format configuration
	entry: ["src/main.ts"],
	format: ["esm"],
	// Emit `.js` rather than tsdown's default `.mjs`: `package.json` already
	// declares `"type": "module"`, so the plain extension is unambiguous
	// and keeps the `bin` path stable.
	outExtensions: () => ({ js: ".js" }),

	// Output configuration
	outDir: "dist",
	dts: false,
	sourcemap: true,
	clean: true,

	// Build behavior
	minify: false,
	treeshake: true,

	// Platform and target. Unlike the SDK this is a local harness, not a
	// browser-shippable library: it reads and writes files, so it targets Node.
	platform: "node",
	target: "es2022",

	// External dependencies (not bundled)
	deps: {
		neverBundle: ["@nvisy/sdk"],
	},
});
