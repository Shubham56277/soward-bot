# Requirements Document

## Introduction

This feature integrates the standalone antinuke v2 protection engine into the Soward Discord bot monorepo. The antinuke source (`antinuke/antinuke/`) contains a fully-featured, battle-tested protection engine that currently runs against its own Prisma database and Redis instance. The goal is to port that engine so it runs natively inside `apps/bot` — using Drizzle ORM (`@repo/db`), Soward's existing `ioredis` instance (`client.redis`), and Soward's `BaseClient` / `Event` / `Command` abstractions — while replacing the old, simplistic `AntiNukeService` entirely.

The resulting system must protect Discord guilds from nuking attacks in real-time, log incidents to a configurable channel, support role/user whitelisting with tier limits, enforce panic mode, and provide an interactive v2 slash command for configuration — all scoped per-guild and gated behind a premium check.

## Glossary

- **AntiNuke_System**: The ported antinuke v2 engine running inside `apps/bot`.
- **BaseClient**: The Soward bot's `BaseClient` class (`apps/bot/src/base/Client.ts`) that extends `FrameWorkClient`.
- **AntiNukeStore**: The Drizzle-based data access layer (`apps/bot/src/antinuke/store.ts`) that replaces Prisma-backed `antinukeStore.ts`.
- **AntiNukeRuntime**: The core protection engine (`apps/bot/src/antinuke/runtime.ts`) that evaluates actions and applies punishments.
- **AntiNukeConfig**: The per-guild configuration record stored in `antinuke_configs` Drizzle table.
- **AntiNukeIncident**: A logged protection enforcement event stored in `antinuke_incidents` Drizzle table.
- **AntiNukeAudit**: An administrative change record stored in `antinuke_audits` Drizzle table.
- **AutoRecovery**: The module that automatically reverts unauthorized guild/channel/role/member-role changes.
- **Gen3**: The 3rd-generation join gate and username filter that screens new members based on account age, avatar, advertising names, and suspicious account heuristics.
- **PremiumGuard**: The `isGuildPremiumActive` / `getPremiumGuildIds` helpers that check the `guild_premium` Drizzle table.
- **PanicMode**: Emergency lockdown mode that quarantines members and enforces strict role permissions, backed by the `panic_mode_configs` Drizzle table.
- **Whitelist**: A set of users or roles granted permission to perform protected actions without triggering the AntiNuke_System.
- **Executor**: The Discord user whose audit log entry caused a protection event to fire.
- **LRU_Cache**: Bounded in-memory Least-Recently-Used cache (via `lru-cache` package) used to deduplicate rapid events.
- **Threshold_Window**: The rolling time window (in seconds) within which action counts are measured against per-action thresholds.
- **ANTINUKE_PROTECTED_ACTIONS**: The enumerated set of 31 Discord audit log action types that the AntiNuke_System monitors.

---

## Requirements

### Requirement 1: Database Schema Extension

**User Story:** As a system administrator, I want the Drizzle schema to include the three new antinuke v2 tables, so that the ported engine has a proper persistence layer without breaking existing migrations.

#### Acceptance Criteria

1. THE AntiNuke_System SHALL add a `antinuke_configs` table to `packages/db/src/schema.ts` that stores all fields defined by the `AntiNukeConfig` interface: `guildId` (primary key, foreign key to `guilds`), `enabled`, `enabledActions` (text array), `moduleStates` (jsonb), `extraOwnerIds` (text array), `requiredRoleIds` (text array), `punishment` (text), `logChannelId` (text nullable), `whitelistUserIds` (text array), `whitelistAccess` (jsonb), `whitelistRoleIds` (text array), `whitelistRoleAccess` (jsonb), `thresholds` (jsonb), `notifyOwner` (boolean), `lockdownSnapshot` (jsonb), `lockdownActive` (boolean), `timeoutDuration` (bigint), `thresholdWindow` (integer), `whitelistExpiry` (jsonb), `modulePunishments` (jsonb), `offenceHistory` (jsonb), `webhookUrl` (text nullable), `whitelistLimitsEnabled` (boolean), `whitelistLimitsThreshold` (integer), `whitelistLimitsWindow` (integer), `whitelistLimitsPunishment` (text), `whitelistLimitsActions` (text array), `whitelistLimitsBypassRoles` (text array), `createdAt` (timestamp), `updatedAt` (timestamp).
2. THE AntiNuke_System SHALL add a `antinuke_incidents` table with fields: `id` (text primary key), `guildId` (text, foreign key to `guilds`), `executorId` (text), `action` (text), `punishment` (text), `contextLabel` (text), `threshold` (integer), `targetId` (text nullable), `recovered` (boolean default false), `details` (text nullable), `createdAt` (timestamp).
3. THE AntiNuke_System SHALL add a `antinuke_audits` table with fields: `id` (text primary key), `guildId` (text, foreign key to `guilds`), `actorId` (text), `command` (text), `details` (jsonb), `createdAt` (timestamp).
4. THE AntiNuke_System SHALL preserve the existing `anti_nuke` table without modification so that no existing migrations are broken.
5. WHEN the Drizzle migration is applied, THE AntiNuke_System SHALL create all three new tables without conflicts or errors.

---

### Requirement 2: Drizzle-Based Store (antinuke/store.ts)

**User Story:** As a developer, I want all antinuke CRUD operations to use Drizzle ORM and Soward's `ioredis` instance, so that the ported engine does not depend on Prisma or a separate Redis connection.

#### Acceptance Criteria

1. THE AntiNukeStore SHALL export all type definitions from the original `antinukeStore.ts`: `AntiNukePunishment`, `AntiNukeTierName`, `AntiNukeAction`, `AntiNukeWhitelistAccessProfile`, `AntiNukeOffenceRecord`, `AntiNukeConfig`, `AntiNukeIncident`, `AntiNukeAudit`, and all constants (`ANTINUKE_PROTECTED_ACTIONS`, `ANTINUKE_DEFAULT_THRESHOLDS`, `ANTINUKE_WHITELIST_LIMIT`, etc.).
2. WHEN `getAntiNukeConfig(guildId, redis)` is called, THE AntiNukeStore SHALL first check Redis for a cached JSON string at key `antinuke:config:{guildId}`; IF the key holds the `__NULL__` sentinel, THE AntiNukeStore SHALL return `null`; IF valid JSON is found, THE AntiNukeStore SHALL parse and return the config.
3. WHEN `getAntiNukeConfig` encounters a cache miss, THE AntiNukeStore SHALL query `antinuke_configs` via Drizzle, and IF no row is found, THE AntiNukeStore SHALL write the `__NULL__` sentinel to Redis with a 60-second TTL and return `null`.
4. WHEN `upsertAntiNukeConfig(config, redis)` is called, THE AntiNukeStore SHALL run a Drizzle `insert … onConflictDoUpdate` (upsert) and invalidate the Redis cache by setting the new serialized config with a 3600-second TTL.
5. WHEN `updateAntiNukeConfig(guildId, changes, redis)` is called, THE AntiNukeStore SHALL fetch the existing config, merge the changes, run a Drizzle `update`, and refresh the Redis cache.
6. WHEN `addAntiNukeIncident(incident, redis)` is called, THE AntiNukeStore SHALL insert the sanitized incident into `antinuke_incidents` and, after every 20th insertion per guild, count total incidents and prune the oldest rows when the total exceeds 225 (keeping at most 200 rows).
7. WHEN `addAntiNukeAudit(guildId, actorId, command, details, redis)` is called, THE AntiNukeStore SHALL insert a row into `antinuke_audits`.
8. WHEN `listAntiNukeIncidents(guildId, limit, redis)` is called with a limit between 1 and 200, THE AntiNukeStore SHALL return incidents ordered by `createdAt` descending.
9. WHEN `clearAntiNukeIncidents(guildId, redis)` is called, THE AntiNukeStore SHALL delete all incidents for that guild and return the deleted row count.
10. IF an input to `upsertAntiNukeConfig` or `updateAntiNukeConfig` contains an invalid punishment value, THE AntiNukeStore SHALL normalise it to `"ban"`.
11. IF an input to `upsertAntiNukeConfig` or `updateAntiNukeConfig` contains a `whitelistUserIds` array exceeding 50 entries, THE AntiNukeStore SHALL truncate it to 50 entries.

---

### Requirement 3: Premium Guard

**User Story:** As a guild owner, I want the antinuke protection to be available only to premium guilds, so that the feature is appropriately gated.

#### Acceptance Criteria

1. WHEN `isGuildPremiumActive(guildId)` is called, THE PremiumGuard SHALL query the `guild_premium` Drizzle table and return `true` if and only if `isPremium` is `true` AND (`premiumUntil` is null OR `premiumUntil` is in the future).
2. WHEN `getPremiumGuildIds()` is called, THE PremiumGuard SHALL return a `Set<string>` of all guild IDs where `isPremium = true` and the subscription has not expired.
3. IF a guild's premium status has expired (i.e., `premiumUntil` is in the past), THE PremiumGuard SHALL return `false` from `isGuildPremiumActive` for that guild.

---

### Requirement 4: Panic Mode Helpers

**User Story:** As a security engineer, I want the panic mode logic to read from the `panic_mode_configs` Drizzle table, so that emergency lockdowns integrate with the existing schema.

#### Acceptance Criteria

1. WHEN `getPanicConfigFromAntiNuke(guildId)` is called, THE PanicMode module SHALL query the `panic_mode_configs` table via Drizzle and return the config or `null` if no row exists.
2. WHEN `enforcePanicMode(guild, config)` is called and `config.enabled` is `true`, THE PanicMode module SHALL set all roles listed in `config.lockdownRoles` to remove dangerous permissions using the `dangerousRolePermissions` helper.
3. WHEN `quarantineMember(guild, memberId, config)` is called, THE PanicMode module SHALL remove all manageable roles from the member and apply a 28-day timeout if possible.

---

### Requirement 5: Core Protection Runtime (antinuke/runtime.ts)

**User Story:** As a guild owner, I want the core antinuke engine to evaluate every audit log event, enforce thresholds, and punish violators — all using `BaseClient` instead of the standalone `Bot` class.

#### Acceptance Criteria

1. THE AntiNukeRuntime SHALL accept `BaseClient` wherever the original code accepted `Bot`, with no references to the `Bot` class or standalone framework imports remaining.
2. WHEN `evaluateAntiNukeAction(client, guild, action, options)` is called, THE AntiNukeRuntime SHALL call `isGuildPremiumActive` and return `{ shouldEnforce: false }` if the guild is not premium.
3. WHEN `evaluateAntiNukeAction` is called and the guild is premium, THE AntiNukeRuntime SHALL retrieve the `AntiNukeConfig` (using the store with `client.redis`), and return `{ shouldEnforce: false }` if `config.enabled` is `false` or the action's module key is disabled in `moduleStates`.
4. WHEN an executor is resolved from audit logs and that executor is the guild owner, the bot itself, or in `extraOwnerIds`, THE AntiNukeRuntime SHALL return `{ shouldEnforce: false }`.
5. WHEN an executor is in the whitelist (via `whitelistUserIds`, `whitelistAccess`, or a whitelisted role) and their whitelist has not expired, THE AntiNukeRuntime SHALL check global and tier rate limits; IF the limits are not exceeded, THE AntiNukeRuntime SHALL return `{ shouldEnforce: false }`.
6. WHEN a whitelisted user's global action count within `whitelistLimitsWindow` seconds exceeds `whitelistLimitsThreshold`, THE AntiNukeRuntime SHALL revoke the whitelist entry and return `{ shouldEnforce: true, isWhitelistViolation: true }`.
7. WHEN action thresholds are exceeded within the `thresholdWindow`, THE AntiNukeRuntime SHALL call `runAntiNukeProtection` or `runAntiNukeProtectionDetailed` to apply the punishment.
8. WHEN `applyAntiNukeMemberPunishment(guild, memberId, punishment, reason, timeoutDuration, member)` is called, THE AntiNukeRuntime SHALL apply the appropriate Discord action: `ban`, `kick`, `timeout`, `rolestrip`, `quarantine`, or `staged` ban.
9. WHEN `sendIncidentLog(guild, logChannelId, title, description, meta)` is called and `logChannelId` refers to a valid text channel, THE AntiNukeRuntime SHALL send an embed to that channel; IF `webhookUrl` is configured, THE AntiNukeRuntime SHALL also deliver the log to the webhook URL.
10. WHEN `startAntiNukeCounterCleanup(registerInterval)` is called during bot startup, THE AntiNukeRuntime SHALL periodically purge stale LRU cache entries on a 5-minute interval.
11. THE AntiNukeRuntime SHALL use `client.redis` (passed through store functions) for all cache operations, with no standalone Redis instantiation.
12. WHEN audit logs are fetched for a guild, THE AntiNukeRuntime SHALL use the shared `LRU_Cache`-backed deduplication mechanism to avoid redundant API calls during rapid attack bursts.

---

### Requirement 6: Auto-Recovery Module (antinuke/autoRecovery.ts)

**User Story:** As a guild owner, I want the bot to automatically reverse unauthorized guild, channel, role, and member-role changes so that attack damage is minimised.

#### Acceptance Criteria

1. WHEN `autoRecovery` is enabled in `AntiNukeConfig.moduleStates` and an unauthorized guild update is detected, THE AutoRecovery module SHALL call `restoreUpdatedGuild` to revert name, description, icon, banner, splash, and discovery splash to their pre-attack values.
2. WHEN an unauthorized channel is created, THE AutoRecovery module SHALL call `cleanupUnauthorizedChannel` to delete it.
3. WHEN a channel is deleted by an unauthorized executor, THE AutoRecovery module SHALL call `recoverDeletedChannel` to recreate it with original permissions and position.
4. WHEN an unauthorized channel update is detected, THE AutoRecovery module SHALL call `restoreUpdatedChannel` to revert all changed properties.
5. WHEN an unauthorized role is created, THE AutoRecovery module SHALL call `cleanupUnauthorizedRole` to delete it.
6. WHEN a role is deleted by an unauthorized executor, THE AutoRecovery module SHALL call `recoverDeletedRole` to recreate it with original color, permissions, and position.
7. WHEN an unauthorized role update is detected, THE AutoRecovery module SHALL call `restoreUpdatedRole` to revert name, color, permissions, hoist, mentionable, and position.
8. WHEN a member's roles are changed by an unauthorized executor, THE AutoRecovery module SHALL call `restoreMemberRoles` to reconstruct and restore the pre-attack role state using cached audit logs.
9. WHILE a recovery operation is in progress for a specific entity, THE AutoRecovery module SHALL prevent re-triggering via an in-memory guard set with the appropriate cooldown period.
10. WHEN `sendRecoveryReport(guild, recoveryType, details)` is called, THE AutoRecovery module SHALL deliver a report embed to the guild's configured `logChannelId`.

---

### Requirement 7: Gen3 Join Gate and Username Filter (antinuke/gen3.ts)

**User Story:** As a guild owner, I want a third-generation join screening system that detects and punishes suspicious accounts, advertisers, underage accounts, avatarless users, and username-filtered members at join time and on profile updates.

#### Acceptance Criteria

1. WHEN `runGen3JoinGate(client, member)` is called for a new guild member, THE Gen3 module SHALL first verify that the guild is premium and that `config.enabled` is `true` and `gen3.masterEnabled` is `true`.
2. WHEN `gen3.suspicious_account.enabled` is `true` and `userLooksSuspicious(user)` returns `true`, THE Gen3 module SHALL apply the `suspicious_account` module's configured punishment to the member.
3. WHEN `gen3.advertising_name.enabled` is `true` and `userHasAdvertisingName(user, nick)` returns `true`, THE Gen3 module SHALL apply the `advertising_name` module's configured punishment.
4. WHEN `gen3.account_age.enabled` is `true` and the account age is less than `minAgeValue` `minAgeUnit`, THE Gen3 module SHALL apply the `account_age` module's configured punishment.
5. WHEN `gen3.no_avatar.enabled` is `true` and the user has no custom avatar, THE Gen3 module SHALL apply the `no_avatar` module's configured punishment.
6. WHEN `gen3.username_filter.enabled` is `true` and the user's username, global name, or nickname matches a strict or wildcard word, THE Gen3 module SHALL apply the `username_filter` module's configured punishment.
7. WHEN a member is in the Gen3 bypass list (guild owner, bot, `extraOwnerIds`, or whitelisted user/role), THE Gen3 module SHALL skip all checks and return without taking action.
8. WHEN `runGen3UserProfileEnforcement(client, oldUser, newUser)` is called after a user's username changes, THE Gen3 module SHALL iterate only premium guilds (using `getPremiumGuildIds()`) and apply the `username_filter` module if `postJoin` is enabled and the new name matches.
9. WHEN `runGen3MemberDisplayEnforcement(client, oldMember, newMember)` is called after a member's nickname changes, THE Gen3 module SHALL apply the `username_filter` module if `postJoin` is enabled and the new nickname matches.
10. WHEN a Gen3 module fires, THE Gen3 module SHALL write an audit entry via `addAntiNukeAudit` and send an incident log via `sendIncidentLog`.

---

### Requirement 8: Event Listeners (37 listeners)

**User Story:** As a security engineer, I want every relevant Discord event to be covered by an antinuke listener that calls the runtime's protection engine, so that no attack vector is left unmonitored.

#### Acceptance Criteria

1. THE AntiNuke_System SHALL provide one `Event` subclass per antinuke action, placed in `apps/bot/src/events/guild/antinuke/`, for each of the 37 event types listed in `antinuke/antinuke/events/`: `banAdd`, `banRemove`, `memberKick`, `memberPrune`, `botAdd`, `channelCreate`, `channelDelete`, `channelUpdate`, `dangerousJoin`, `emojiCreate`, `emojiDelete`, `emojiUpdate`, `gen3MemberUpdate`, `gen3UserUpdate`, `guildEventCreate`, `guildEventDelete`, `guildEventUpdate`, `guildUpdate`, `integrationUpdate`, `inviteDelete`, `inviteRole`, `memberPrune` (audit), `memberRoleUpdate`, `messagePing`, `roleCreate`, `roleDelete`, `roleUpdate`, `soundboardCreate`, `soundboardDelete`, `soundboardUpdate`, `stickerCreate`, `stickerDelete`, `stickerUpdate`, `webhookUpdate`, `automodCreate`, `automodDelete`, `automodUpdate`.
2. WHEN a listener's Discord event fires, THE listener SHALL call `runAntiNukeProtection` or `runAntiNukeProtectionDetailed` from the AntiNukeRuntime with the appropriate action type and audit options.
3. WHEN `runAntiNukeProtectionDetailed` returns `{ enforced: true }` and `autoRecovery` is enabled, THE listener SHALL invoke the corresponding AutoRecovery function (e.g., `unban` for `banAdd`, `recoverDeletedChannel` for `channelDelete`).
4. WHEN a listener calls the runtime, THE listener SHALL pass `client.redis` through the store layer so no listener creates its own Redis connection.
5. WHEN the existing `apps/bot/src/events/guild/banAdd.ts` (and other existing event files that call the old `AntiNukeService`) are superseded by the new listeners, THE AntiNuke_System SHALL remove or replace the old event handler logic so there are no duplicate registrations for the same event.

---

### Requirement 9: Antinuke v2 Command (commands/security/Antinuke.ts)

**User Story:** As a guild owner, I want a comprehensive `/antinuke` slash command that lets me enable, disable, configure modules, manage the whitelist, manage extra owners, view incident logs, and configure Gen3 — all through the v2 config interface.

#### Acceptance Criteria

1. THE Antinuke_Command SHALL be accessible only to the guild owner and users listed in `extraOwnerIds`.
2. THE Antinuke_Command SHALL provide the following top-level subcommands: `enable`, `disable`, `config`, `whitelist`, `modules`, `logs`, `gen3`, and `extraowner`.
3. WHEN the `/antinuke enable` subcommand is used, THE Antinuke_Command SHALL call `upsertAntiNukeConfig` with `enabled: true` and confirm to the user.
4. WHEN the `/antinuke disable` subcommand is used, THE Antinuke_Command SHALL call `updateAntiNukeConfig` with `enabled: false` and confirm to the user.
5. WHEN the `/antinuke config` subcommand is used, THE Antinuke_Command SHALL display the current `AntiNukeConfig` (punishment, logChannelId, thresholdWindow, etc.) and provide interactive buttons to edit each field.
6. WHEN the `/antinuke whitelist add <user>` subcommand is used, THE Antinuke_Command SHALL add the user to `whitelistUserIds` or `whitelistAccess` (up to the 50-entry limit) and confirm.
7. WHEN the `/antinuke whitelist remove <user>` subcommand is used, THE Antinuke_Command SHALL remove the user from both `whitelistUserIds` and `whitelistAccess` and confirm.
8. WHEN the `/antinuke whitelist list` subcommand is used, THE Antinuke_Command SHALL display a paginated list of all whitelisted users.
9. WHEN the `/antinuke modules` subcommand is used, THE Antinuke_Command SHALL display an interactive menu of all 31 protection modules, allowing the user to toggle each on or off in `config.moduleStates`.
10. WHEN the `/antinuke logs` subcommand is used, THE Antinuke_Command SHALL fetch up to 20 recent incidents via `listAntiNukeIncidents` and display them in a paginated embed.
11. WHEN the `/antinuke gen3` subcommand is used, THE Antinuke_Command SHALL display the current Gen3 configuration parsed from `config.moduleStates` and allow the user to enable/disable the master switch and individual modules.
12. WHEN an unauthorised user attempts to use THE Antinuke_Command, THE command SHALL return an ephemeral error message.

---

### Requirement 10: Service and Client Wiring

**User Story:** As a developer, I want the old `AntiNukeService` replaced and the new runtime's counter-cleanup registered at startup, so that the bot boots cleanly with the v2 system active.

#### Acceptance Criteria

1. THE AntiNuke_System SHALL remove the `AntiNukeService` import and instantiation from `apps/bot/src/service/index.ts` (or reduce it to a thin no-op wrapper if other code still references `client.services.antinukes`).
2. WHEN the bot starts up in `apps/bot/src/base/Client.ts`, THE AntiNuke_System SHALL call `startAntiNukeCounterCleanup` with a wrapper that registers a `setInterval` so that LRU counters are purged every 5 minutes.
3. WHEN the bot's `ready` event fires, THE AntiNuke_System SHALL log a startup message confirming the antinuke v2 system is active.
4. THE AntiNuke_System SHALL export all antinuke modules through a barrel file at `apps/bot/src/antinuke/index.ts`.
5. IF any existing event file in `apps/bot/src/events/guild/` still imports `AntiNukeService` for antinuke protection logic, THE AntiNuke_System SHALL update that file to use the new runtime instead.
