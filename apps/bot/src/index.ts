import "reflect-metadata";
import Logger from "./lib/Logger";
import fs from "node:fs";
import path from "node:path";
import { ThemeSelector } from "./utils/ThemeSelector";
import { shardStart } from "./cluster";
const logger = new Logger();

const theme = new ThemeSelector();
function setConsoleTitle(title: string): void {
	process.stdout.write(`\x1b]0;${title}`);
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.stack || `${error.name}: ${error.message}`;
	}
	try {
		return JSON.stringify(error, null, 2);
	} catch {
		return String(error);
	}
}

function installProcessDiagnostics(): void {
	process.on("unhandledRejection", (reason, promise) => {
		logger.error("[process] unhandledRejection at promise:", promise);
		logger.error(formatError(reason));
	});

	process.on("rejectionHandled", (promise) => {
		logger.warn("[process] rejectionHandled:", promise);
	});

	process.on("uncaughtException", (err) => {
		logger.error("[process] uncaughtException:");
		logger.error(formatError(err));
	});

	process.on("uncaughtExceptionMonitor", (err) => {
		logger.error("[process] uncaughtExceptionMonitor:");
		logger.error(formatError(err));
	});

	process.on("warning", (warning) => {
		logger.warn("[process] warning:");
		logger.warn(formatError(warning));
	});

	process.on("beforeExit", (code) => {
		logger.warn(`[process] beforeExit code=${code}`);
	});

	process.on("exit", (code) => {
		logger.warn(`[process] exit code=${code}`);
	});
}

installProcessDiagnostics();

function resolveLogoPath(): string | null {
	const candidates = [
		path.join(process.cwd(), "apps", "bot", "src", "utils", "logo.txt"),
		path.join(process.cwd(), "apps", "bot", "dist", "utils", "logo.txt"),
		path.join(process.cwd(), "src", "utils", "logo.txt"),
		path.join(__dirname, "..", "src", "utils", "logo.txt"),
		path.join(__dirname, "utils", "logo.txt"),
	];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}

	return null;
}

(async () => {
	try {
		logger.start("[startup] entrypoint begin");
		const logoPath = resolveLogoPath();
		logger.debug(`[startup] logo path candidates checked: ${JSON.stringify([
			path.join(process.cwd(), "apps", "bot", "src", "utils", "logo.txt"),
			path.join(process.cwd(), "apps", "bot", "dist", "utils", "logo.txt"),
			path.join(process.cwd(), "src", "utils", "logo.txt"),
			path.join(__dirname, "..", "src", "utils", "logo.txt"),
			path.join(__dirname, "utils", "logo.txt"),
		], null, 2)}`);
		if (!logoPath) {
			logger.error("[startup] logo.txt file is missing from every known location");
			process.exit(1);
		}
		logger.success(`[startup] logo path confirmed: ${logoPath}`);
		console.clear();
		setConsoleTitle("Soward");
		logger.start("[startup] reading logo file");
		const logFile = fs.readFileSync(logoPath, "utf-8");
		logger.success("[startup] logo file read");
		console.log(theme.fire(logFile));
		logger.start("[startup] invoking shardStart");
		await shardStart(logger);
		logger.success("[startup] shardStart completed");
	} catch (err) {
		logger.error("[startup] entrypoint failed:");
		logger.error(formatError(err));
		throw err;
	}
})();
