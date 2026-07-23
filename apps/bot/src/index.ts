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
		// Exit so systemd can restart us on unrecoverable errors
		process.exit(1);
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

	// Graceful shutdown in the cluster manager process
	process.on("SIGTERM", () => {
		logger.warn("[process] Received SIGTERM, shutting down cluster manager...");
		process.exit(0);
	});

	process.on("SIGINT", () => {
		logger.warn("[process] Received SIGINT, shutting down cluster manager...");
		process.exit(0);
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
		logger.info(`[startup] Node.js ${process.version} | PID ${process.pid} | CWD ${process.cwd()}`);
		logger.info(`[startup] NODE_ENV=${process.env.NODE_ENV || "not set"}`);

		const logoPath = resolveLogoPath();
		if (!logoPath) {
			logger.warn("[startup] logo.txt not found, skipping banner display");
		} else {
			logger.success(`[startup] logo path confirmed: ${logoPath}`);
			setConsoleTitle("Soward");
			const logFile = fs.readFileSync(logoPath, "utf-8");
			console.log(theme.fire(logFile));
		}

		logger.start("[startup] invoking shardStart");
		await shardStart(logger);
		logger.success("[startup] shardStart completed - bot is now running");
	} catch (err) {
		logger.error("[startup] entrypoint failed:");
		logger.error(formatError(err));
		process.exit(1);
	}
})();
