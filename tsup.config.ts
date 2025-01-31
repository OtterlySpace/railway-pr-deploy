import { defineConfig } from "tsup"

export default defineConfig({
	clean: true,
	entry: ["src/index.ts"],
	format: ["cjs"],
	minify: true,
	metafile: false,
	bundle: true,
	treeshake: false,
	sourcemap: false,
	target: "esnext",
	outDir: "dist",
	outExtension: () => ({
		js: `.cjs`
	})
})
