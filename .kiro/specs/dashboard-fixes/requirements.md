# Requirements Document

## Introduction

This document describes the requirements for fixing and enhancing `scripts/dashboard.js`, the terminal CLI management dashboard for the Elfaria/Soward Discord bot project.

Four areas need attention: the broken premium code generator (Option 8), the missing guild-level premium grant, the static and unformatted bot log viewer (Option 4), and the absence of a dedicated Bot Restart option in the main menu. All changes must stay within pure Node.js CommonJS, must work on Windows, and must leave every existing menu option fully functional.

---

## Glossary

- **Dashboard**: The Node.js CommonJS script `scripts/dashboard.js` that provides a terminal-based management interface for the Elfaria/Soward Discord bot.
- **Bot**: The Discord bot process managed by the Dashboard, identified by the PID stored in `logs/bot.pid`.
- **DB Package**: The compiled Drizzle ORM package located at `packages/db/dist/index.js`, used to interact with the PostgreSQL database via the `DATABASE_URI` environment variable.
- **Premium_Code**: A one-time-use redemption code of the form `SWRD-<32 hex chars>` stored (as a SHA-256 hash) in the `premium_codes` database table.
- **Guild_Premium**: A row in the `guild_premium` database table that grants server-level premium to a specific Discord guild, identified by `guildId`.
- **Code_Output**: The JSON object `{ code, expiresAt }` printed to stdout by the inline Node child process used for premium code generation.
- **Bot_Log**: The file `logs/bot.log` written by the bot process, containing timestamped log lines at levels INFO, WARN, ERROR, and DEBUG.
- **Dashboard_Log**: The file `logs/dashboard.log` written by the Dashboard itself.
- **Live_Tail_Mode**: A log-viewing sub-mode in which new lines appended to `logs/bot.log` are displayed in real time until the operator presses a key to stop.
- **Context_Window**: The configurable number of lines shown before and after an ERROR line when displaying enriched error context.
- **PID_File**: The file `logs/bot.pid` used to track the running bot process ID.

---

## Requirements

### Requirement 1: Fix Premium Code Generation

**User Story:** As a bot operator, I want Option 8 to reliably generate and display a `SWRD-...` premium code so that I can share it with users without having to fall back to manual bot commands.

#### Acceptance Criteria

1. WHEN the operator selects Option 8 and enters a valid duration, THE Dashboard SHALL execute the DB insertion in a child process that explicitly calls `process.exit(0)` after the database promise resolves, ensuring the connection pool is closed and the process terminates.

2. WHEN the DB child process completes, THE Dashboard SHALL parse Code_Output exclusively from the last JSON-parseable line of `stdout`, ignoring any preceding non-JSON lines such as database connection log messages.

3. WHEN `result.stderr` contains only non-fatal output (e.g., informational driver messages), THE Dashboard SHALL NOT treat it as a failure; failure SHALL be determined solely by a non-zero exit code from the child process.

4. WHEN the child process exits with a zero exit code and a parseable Code_Output is found, THE Dashboard SHALL display the generated `SWRD-...` code and its expiry timestamp in the terminal with distinct formatting.

5. WHEN the child process exits with a non-zero exit code or no parseable Code_Output is found after a 15-second timeout, THE Dashboard SHALL display the actual error message from `result.stderr` or `result.stdout` and then show the manual fallback instructions.

6. WHEN constructing the path to the DB package inside the inline Node `-e` script, THE Dashboard SHALL use a path-construction method that does not embed raw Windows backslash escape sequences directly in the string literal, so that the path remains valid regardless of the workspace root path.

---

### Requirement 2: Guild-Level Premium Grant

**User Story:** As a bot operator, I want to optionally grant server-level premium to a specific Discord guild when generating a premium code so that I can activate premium features for a guild directly from the Dashboard without using bot commands.

#### Acceptance Criteria

1. WHEN the operator selects Option 8 and enters a valid duration, THE Dashboard SHALL prompt the operator for an optional Discord Guild ID before proceeding to code generation.

2. WHEN the operator provides a non-empty Guild ID, THE Dashboard SHALL validate that the value is a string of 17 to 20 numeric digits before proceeding.

3. IF the operator provides a Guild ID that fails numeric-digit or length validation, THEN THE Dashboard SHALL display a clear validation error and re-prompt for the Guild ID without aborting the entire premium flow.

4. WHEN the operator leaves the Guild ID prompt empty and confirms, THE Dashboard SHALL skip the guild-level grant and generate only the Premium_Code.

5. WHEN a valid Guild ID is provided, THE Dashboard SHALL include an additional DB operation in the same child process that upserts a row in the `guild_premium` table, and the persisted row SHALL have `guildId` equal to the provided value, `isPremium` equal to `true`, `premiumSince` equal to the timestamp at the moment of insertion, and `premiumUntil` equal to that same timestamp plus the specified duration in milliseconds.

6. WHEN the guild upsert succeeds, THE Dashboard SHALL display a confirmation message showing the Guild ID and the `premiumUntil` timestamp alongside the generated Premium_Code.

7. IF the guild upsert fails while the code insertion succeeds, THEN THE Dashboard SHALL display the generated Premium_Code and a separate warning indicating that the guild grant failed, along with the error details.

---

### Requirement 3: Improved Bot Log Viewer

**User Story:** As a bot operator, I want Option 4 to show color-coded log lines and offer a live-tail mode so that I can monitor the bot in real time and quickly spot errors with surrounding context.

#### Acceptance Criteria

1. WHEN the operator selects Option 4, THE Dashboard SHALL display the last 40 lines of `logs/bot.log` with color coding applied: ERROR lines in red, WARN lines in yellow, INFO and OK lines in the default terminal color, and DEBUG lines in gray.

2. WHEN the operator selects Option 4, THE Dashboard SHALL ask whether to enter Live_Tail_Mode after displaying the initial snapshot.

3. WHEN the operator confirms Live_Tail_Mode, THE Dashboard SHALL poll `logs/bot.log` at an interval no greater than 500 milliseconds and print each newly appended line with the same color-coding rules defined in criterion 3.1.

4. WHILE in Live_Tail_Mode, THE Dashboard SHALL listen for any keypress on stdin and, upon receiving one, stop polling and return to the main menu.

5. WHEN a line in the log snapshot or live tail is classified as an ERROR line, THE Dashboard SHALL also display up to 3 lines of context before and after that ERROR line (where available) in gray, so that the operator can see what triggered the error.

6. IF `logs/bot.log` does not exist or cannot be read when Option 4 is selected, THEN THE Dashboard SHALL display a clear notice instructing the operator to start the bot, and SHALL still offer Live_Tail_Mode so the operator can wait for the file to be created; once the file appears during Live_Tail_Mode, THE Dashboard SHALL begin displaying its contents with the same color-coding rules.

---

### Requirement 4: Bot Restart Option

**User Story:** As a bot operator, I want a single Restart option in the main menu so that I can stop and start the bot in one step without navigating two separate menu choices.

#### Acceptance Criteria

1. THE Dashboard SHALL include a new menu entry labelled "RESTART BOT" with a unique option number that does not conflict with any existing menu numbers.

2. WHEN the operator selects Restart Bot and the Bot is running, THE Dashboard SHALL stop the Bot process using the same logic as the Stop Bot action (SIGTERM then SIGKILL after a short wait, plus PID_File cleanup).

3. WHEN the operator selects Restart Bot and the Bot is not running, THE Dashboard SHALL skip the stop step and proceed directly to the start step, logging a notice that no running process was found.

4. WHEN the operator selects Restart Bot, THE Dashboard SHALL ask whether to rebuild the bot before restarting (yes/no prompt, defaulting to no).

5. WHEN the operator confirms a rebuild, THE Dashboard SHALL execute `yarn bot:build` synchronously before starting the bot, and SHALL abort the restart and display an error if the build exits with a non-zero status.

6. AFTER the stop step (and optional build step) complete successfully, THE Dashboard SHALL start the Bot using the same logic as the Start Bot action, including ensuring Redis is running.

7. WHEN the restart completes, THE Dashboard SHALL report the new PID and inform the operator that logs are being written to `logs/bot.log`.

---

### Requirement 5: Backward Compatibility and Constraints

**User Story:** As a bot operator, I want all existing menu options to continue working exactly as before so that changes to the dashboard do not introduce regressions.

#### Acceptance Criteria

1. THE Dashboard SHALL remain a pure Node.js CommonJS script with no TypeScript, no ES modules, and no new `require()` calls for packages not already present in the repository.

2. WHEN any existing menu option (1 through 11) is selected after the changes, THE Dashboard SHALL produce the same observable outcome as before the changes, with the exception of Options 1, 2, 4, and 8 which are explicitly modified by Requirements 1 through 4; internal logic paths of unmodified options MAY change provided the end result remains identical.

3. THE Dashboard SHALL continue to use `spawnSync` and `spawn` from `node:child_process` for all subprocess management, consistent with the existing implementation.

4. THE Dashboard SHALL continue to write all operator actions and errors to `logs/dashboard.log` using the existing `log()` helper, including all new actions introduced by Requirements 1 through 4.

5. WHEN running on Windows, THE Dashboard SHALL produce correct behavior for all new and modified features without requiring POSIX-only APIs or shell constructs.
