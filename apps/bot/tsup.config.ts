import { type Options, defineConfig } from "tsup";

export default defineConfig((options: Options) => ({
	entryPoints: ["src/**/*.ts"],
	clean: true,
	dts: false,
	format: ["cjs"],
	minify: false,
	skipNodeModulesBundle: true,
	sourcemap: true,
	target: "es2022",
	tsconfig: "tsconfig.json",
	shims: false,
	keepNames: true,
	splitting: false,
	...options,
}));