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

(async () => {
	try {
		const logoPath = path.join(__dirname, "..", "src", "utils", "logo.txt");
		if (!fs.existsSync(logoPath)) {
			logger.error("logo.txt file is missing");
			process.exit(1);
		}
		console.clear();
		setConsoleTitle("Soward");
		const logFile = fs.readFileSync(logoPath, "utf-8");
		console.log(theme.fire(logFile));
		
		await shardStart(logger);
	} catch (err) {
		logger.error("[CLIENT] An error has occurred:", err);
	}
})();
