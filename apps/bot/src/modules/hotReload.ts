/**
 * Hot Reload Module
 * 
 * Handles SIGUSR1 signal from the deployment dashboard to reload
 * commands, events, buttons, menus without restarting the process.
 * 
 * Handles SIGUSR2 signal to save music state before a graceful restart.
 */

import { Collection } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import type BaseClient from "../base/Client";
import type { ButtonOptions } from "../abstract/Button";
import type { CommandOptions } from "../abstract/Command";
import type { MenuOptions } from "../abstract/Menu";
import { normalizeRegistryKey } from "../config/commandRegistry";

const REDIS_MUSIC_KEY = "deploy:music_sessions";
const REDIS_HOT_RELOAD_KEY = "deploy:hot-reload";

interface MusicSessionState {
	guildId: string;
	voiceChannelId: string;
	textChannelId: string | null;
	track: string | null; // encoded track
	position: number;
	queue: string[]; // encoded tracks
	volume: number;
	paused: boolean;
	repeatMode: string;
	autoplay: boolean;
	filters: Record<string, any>;
	timestamp: number;
}

interface HotReloadHandlerState {
	pollInterval: NodeJS.Timeout;
	onSigusr1: () => void;
	onSigusr2: () => void;
}

const installedHandlers = new WeakMap<BaseClient, HotReloadHandlerState>();

/** Install idempotent hot-reload handlers and return their cleanup function. */
export function installHotReloadHandlers(client: BaseClient): () => void {
	if (installedHandlers.has(client)) return () => uninstallHotReloadHandlers(client);

	const deployCommandKey = "deploy:command";
	let polling = false;
	const pollInterval = setInterval(() => {
		if (polling) return;
		polling = true;
		void (async () => {
			try {
				if (!client.redis || client.redis.status !== "ready") return;
				const command = await client.redis.get(deployCommandKey);
				if (command === "save_music") {
					console.log("[hot-reload] Deploy command: save_music");
					await saveMusicSessions(client);
					await client.redis.del(deployCommandKey);
					await client.redis.set("deploy:ack", "music_saved", "EX", 30);
				} else if (command === "hot_reload") {
					console.log("[hot-reload] Deploy command: hot_reload");
					await performHotReload(client);
					await client.redis.del(deployCommandKey);
					await client.redis.set("deploy:ack", "hot_reload_complete", "EX", 30);
				}
			} catch (error) {
				console.error("[hot-reload] Deploy command polling failed:", error);
			} finally {
				polling = false;
			}
		})();
	}, 1000);
	pollInterval.unref();

	const onSigusr1 = (): void => {
		void performHotReload(client).catch((error) => console.error("[hot-reload] Reload failed:", error));
	};
	const onSigusr2 = (): void => {
		console.log("[hot-reload] SIGUSR2 received — saving music state...");
		void saveMusicSessions(client).catch((error) => console.error("[hot-reload] Music save failed:", error));
	};

	process.on("SIGUSR1", onSigusr1);
	process.on("SIGUSR2", onSigusr2);
	installedHandlers.set(client, { pollInterval, onSigusr1, onSigusr2 });
	return () => uninstallHotReloadHandlers(client);
}

export function uninstallHotReloadHandlers(client: BaseClient): void {
	const state = installedHandlers.get(client);
	if (!state) return;
	clearInterval(state.pollInterval);
	process.removeListener("SIGUSR1", state.onSigusr1);
	process.removeListener("SIGUSR2", state.onSigusr2);
	installedHandlers.delete(client);
}

function registerRuntimeCommand(
	commands: Collection<string, CommandOptions>,
	aliases: Collection<string, string>,
	owners: Map<string, string>,
	command: CommandOptions,
	source: string,
): void {
	const commandName = normalizeRegistryKey(command.name);
	if (!commandName) throw new Error(`Command from ${source} has an empty name`);
	const existingCommand = owners.get(commandName);
	if (existingCommand) {
		throw new Error(`Command name collision: "${command.name}" from ${source} conflicts with ${existingCommand}`);
	}
	owners.set(commandName, `command "${command.name}" from ${source}`);
	commands.set(commandName, command);

	for (const rawAlias of command.aliases ?? []) {
		const alias = normalizeRegistryKey(rawAlias);
		if (!alias) throw new Error(`Command "${command.name}" has an empty alias in ${source}`);
		const existingAlias = owners.get(alias);
		if (existingAlias) {
			throw new Error(`Command alias collision: "${rawAlias}" for "${command.name}" from ${source} conflicts with ${existingAlias}`);
		}
		owners.set(alias, `alias "${rawAlias}" for "${command.name}" from ${source}`);
		aliases.set(alias, commandName);
	}
}

function registerComponent<T extends { id: string }>(collection: Collection<string, T>, component: T, kind: string, source: string): void {
	const id = component.id.trim();
	if (!id) throw new Error(`${kind} from ${source} has an empty component ID`);
	if (collection.has(id)) throw new Error(`Duplicate ${kind} component ID "${id}" in ${source}`);
	collection.set(id, component);
}

/**
 * Perform hot reload of commands, buttons, and menus.
 * Clears require cache for dist/ modules and re-loads them.
 */
export async function performHotReload(client: BaseClient): Promise<void> {
	const distDir = path.join(process.cwd(), "dist");

	// Read what needs reloading from Redis
	let modules: Array<{ file: string; type: string }> = [];
	try {
		const raw = await client.redis.get(REDIS_HOT_RELOAD_KEY);
		if (raw) modules = JSON.parse(raw);
		await client.redis.del(REDIS_HOT_RELOAD_KEY);
	} catch {}

	if (modules.length === 0) {
		// Full reload of all commands and components
		modules = [{ file: "*", type: "all" }];
	}

	const shouldReloadAll = modules.some(m => m.type === "all");
	const reloadCommands = shouldReloadAll || modules.some(m => m.type === "command");
	const reloadButtons = shouldReloadAll || modules.some(m => m.type === "button");
	const reloadMenus = shouldReloadAll || modules.some(m => m.type === "menu");
	const reloadEvents = shouldReloadAll || modules.some(m => m.type === "event");
	const reloadConfigs = shouldReloadAll || modules.some(m => m.type === "config" || m.type === "service");

	let reloaded = 0;

	// Clear module cache for bot dist files
	for (const key of Object.keys(require.cache).sort()) {
		if (key.startsWith(distDir)) {
			const normalizedKey = key.split(path.sep).join("/");
			const shouldClear = (
				(reloadCommands && normalizedKey.includes("/commands/")) ||
				(reloadButtons && normalizedKey.includes("/components/buttons/")) ||
				(reloadMenus && normalizedKey.includes("/components/menus/")) ||
				(reloadEvents && normalizedKey.includes("/events/")) ||
				(reloadConfigs && (normalizedKey.includes("/config/") || normalizedKey.includes("/service/")))
			);
			if (shouldClear) {
				delete require.cache[key];
				reloaded++;
			}
		}
	}

	// Stage every registry and commit only after the complete requested reload validates.
	if (reloadCommands) {
		const oldSize = client.commands.size;
		const commands = new Collection<string, CommandOptions>();
		const aliases = new Collection<string, string>();
		const owners = new Map<string, string>();
		const commandsPath = path.join(distDir, "commands");
		if (fs.existsSync(commandsPath)) {
			for (const dir of fs.readdirSync(commandsPath).sort()) {
				const dirPath = path.join(commandsPath, dir);
				if (!fs.statSync(dirPath).isDirectory()) continue;
				const files = fs.readdirSync(dirPath)
					.filter((file) => file.endsWith(".js") && !file.endsWith(".test.js") && !file.endsWith(".spec.js"))
					.sort();
				for (const file of files) {
					const source = `${dir}/${file}`;
					const cmdModule = require(path.join(dirPath, file));
					const command: CommandOptions = new cmdModule.default(client, file);
					command.category = dir;
					registerRuntimeCommand(commands, aliases, owners, command, source);
				}
			}
		}
		client.commands.clear();
		client.aliases.clear();
		for (const [name, command] of commands) client.commands.set(name, command);
		for (const [alias, name] of aliases) client.aliases.set(alias, name);
		console.log(`[hot-reload] Commands: ${oldSize} → ${client.commands.size}; aliases: ${client.aliases.size}`);
	}

	if (reloadButtons) {
		const buttons = new Collection<string, ButtonOptions>();
		const buttonsPath = path.join(distDir, "components", "buttons");
		if (fs.existsSync(buttonsPath)) {
			for (const file of fs.readdirSync(buttonsPath).filter((entry) => entry.endsWith(".js")).sort()) {
				const mod = require(path.join(buttonsPath, file));
				registerComponent(buttons, new mod.default(client), "button", file);
			}
		}
		client.buttons.clear();
		for (const [id, component] of buttons) client.buttons.set(id, component);
		console.log(`[hot-reload] Buttons reloaded: ${client.buttons.size}`);
	}

	if (reloadMenus) {
		const menus = new Collection<string, MenuOptions>();
		const menusPath = path.join(distDir, "components", "menus");
		if (fs.existsSync(menusPath)) {
			for (const file of fs.readdirSync(menusPath).filter((entry) => entry.endsWith(".js")).sort()) {
				const mod = require(path.join(menusPath, file));
				registerComponent(menus, new mod.default(client), "menu", file);
			}
		}
		client.menus.clear();
		for (const [id, component] of menus) client.menus.set(id, component);
		console.log(`[hot-reload] Menus reloaded: ${client.menus.size}`);
	}

	console.log(`[hot-reload] Complete. Cleared ${reloaded} cached modules.`);
}

/**
 * Save all active music sessions to Redis before a graceful restart.
 */
async function saveMusicSessions(client: BaseClient): Promise<void> {
	const sessions: MusicSessionState[] = [];

	try {
		const players = client.manager?.players;
		if (!players || players.size === 0) {
			console.log("[hot-reload] No active music players to save.");
			await client.redis.set(REDIS_MUSIC_KEY, JSON.stringify([]), "EX", 300);
			return;
		}

		for (const [guildId, player] of players) {
			try {
				const current = player.queue?.current;
				if (!current && (!player.queue?.tracks || player.queue.tracks.length === 0)) continue;

				const session: MusicSessionState = {
					guildId,
					voiceChannelId: player.voiceChannelId || "",
					textChannelId: player.textChannelId || null,
					track: current?.encoded || null,
					position: player.position || 0,
					queue: (player.queue?.tracks || []).map((t: any) => t.encoded).filter(Boolean),
					volume: player.volume ?? 100,
					paused: player.paused ?? false,
					repeatMode: (player as any).repeatMode ?? "off",
					autoplay: (player as any).get?.("autoplay") ?? false,
					filters: {},
					timestamp: Date.now(),
				};
				sessions.push(session);
			} catch (err) {
				console.error(`[hot-reload] Failed to save player for guild ${guildId}:`, err);
			}
		}
	} catch (err) {
		console.error("[hot-reload] Error iterating players:", err);
	}

	// Store in Redis with 5 min TTL
	await client.redis.set(REDIS_MUSIC_KEY, JSON.stringify(sessions), "EX", 300);
	console.log(`[hot-reload] Saved ${sessions.length} music session(s) to Redis.`);
}

/**
 * Restore music sessions from Redis after a restart.
 * Call this after the bot is ready and Lavalink is connected.
 */
export interface MusicRestoreResult {
	restored: number;
	failed: number;
}

export async function restoreMusicSessions(client: BaseClient): Promise<MusicRestoreResult> {
	let restored = 0;
	let failed = 0;

	try {
		const raw = await client.redis.get(REDIS_MUSIC_KEY);
		if (!raw) return { restored, failed };

		const sessions = JSON.parse(raw) as MusicSessionState[];
		if (!Array.isArray(sessions) || sessions.length === 0) return { restored, failed };

		console.log(`[hot-reload] Restoring ${sessions.length} music session(s)...`);

		for (const session of sessions) {
			try {
				if (!session.voiceChannelId || !session.track) {
					failed++;
					continue;
				}

				const guild = client.guilds.cache.get(session.guildId);
				if (!guild) {
					failed++;
					continue;
				}

				const node = client.manager.nodeManager.leastUsedNodes()[0];
				if (!node?.connected) {
					failed++;
					continue;
				}

				let player = client.manager.players.get(session.guildId);
				if (!player) {
					player = client.manager.createPlayer({
						guildId: session.guildId,
						voiceChannelId: session.voiceChannelId,
						textChannelId: session.textChannelId || undefined,
						selfDeaf: true,
						volume: session.volume,
						node,
					});
				}

				await player.connect();
				const elapsed = Math.max(0, Date.now() - session.timestamp);
				await player.play({
					track: { encoded: session.track, requester: null },
					position: Math.max(0, session.position + elapsed),
					paused: session.paused,
					volume: session.volume,
				});

				if (session.queue.length > 0) {
					const tracks = await node.decode.multipleTracks(session.queue, null);
					if (tracks.length > 0) player.queue.add(tracks);
				}

				restored++;
				console.log(`[hot-reload] Restored player for guild ${session.guildId}`);
			} catch (error) {
				failed++;
				console.error(`[hot-reload] Failed to restore session for ${session.guildId}:`, error);
			}
		}

		if (restored > 0) await client.redis.del(REDIS_MUSIC_KEY);
	} catch (error) {
		console.error("[hot-reload] Error restoring music sessions:", error);
		failed++;
	}

	console.log(`[hot-reload] Restored ${restored} music session(s); ${failed} failed.`);
	return { restored, failed };
}
