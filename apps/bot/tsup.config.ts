import { type Options, defineConfig } from "tsup";

export default defineConfig((options: Options) => ({
	entry: ["src/**/*.ts", "!src/**/*.test.ts", "!src/**/*.spec.ts"],
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