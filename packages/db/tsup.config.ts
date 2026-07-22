import { type Options, defineConfig } from "tsup";

export default defineConfig((options: Options) => ({
	entryPoints: ["src/**/*.ts"],
	clean: true,
	dts: true,
	format: ["cjs", "esm"],
	...options,
}));