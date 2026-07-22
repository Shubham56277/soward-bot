import "reflect-metadata";
import Logger from "./lib/Logger";
import fs from "node:fs";
import { ThemeSelector } from "./utils/ThemeSelector";
import { shardStart } from "./cluster";
const logger = new Logger();

const theme = new ThemeSelector();
function setConsoleTitle(title: string): void {
	process.stdout.write(`\x1b]0;${title}`);
}

(async () => {
	try {
		if (!fs.existsSync("./src/utils/logo.txt")) {
			logger.error("logo.txt file is missing");
			process.exit(1);
		}
		console.clear();
		setConsoleTitle("Soward");
		const logFile = fs.readFileSync("./src/utils/logo.txt", "utf-8");
		console.log(theme.fire(logFile));
		
		await shardStart(logger);
	} catch (err) {
		logger.error("[CLIENT] An error has occurred:", err);
	}
})();
