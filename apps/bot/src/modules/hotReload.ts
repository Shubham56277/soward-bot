/**
 * Hot Reload Module
 * 
 * Handles SIGUSR1 signal from the deployment dashboard to reload
 * commands, events, buttons, menus without restarting the process.
 * 
 * Handles SIGUSR2 signal to save music state before a graceful restart.
 */

import fs from "node:fs";
import path from "node:path";
import type BaseClient from "../base/Client";
import type { CommandOptions } from "../abstract/Command";
import type { Redis } from "ioredis";

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

/**
 * Install hot-reload signal handlers on the bot process.
 * Call this once during bot startup.
 */
export function installHotReloadHandlers(client: BaseClient): void {
	// Poll Redis for deploy commands (works reliably with clustered architecture)
	const DEPLOY_CMD_KEY = "deploy:command";
	const pollInterval = setInterval(async () => {
		try {
			if (!client.redis || client.redis.status !== "ready") return;
			const cmd = await client.redis.get(DEPLOY_CMD_KEY);
			if (!cmd) return;

			if (cmd === "save_music") {
				console.log("[hot-reload] Deploy command: save_music");
				await saveMusicSessions(client);
				await client.redis.del(DEPLOY_CMD_KEY);
				await client.redis.set("deploy:ack", "music_saved", "EX", 30);
			}
		} catch {}
	}, 1000); // Check every second
	pollInterval.unref(); // Don't prevent process exit

	// SIGUSR2 as backup for direct PM2 signal (hits cluster manager → workers)
	process.on("SIGUSR2", async () => {
		console.log("[hot-reload] SIGUSR2 received — saving music state...");
		try {
			await saveMusicSessions(client);
		} catch (err) {
			console.error("[hot-reload] Music save failed:", err);
		}
	});
}

/**
 * Perform hot reload of commands, buttons, and menus.
 * Clears require cache for dist/ modules and re-loads them.
 */
async function performHotReload(client: BaseClient): Promise<void> {
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
	for (const key of Object.keys(require.cache)) {
		if (key.startsWith(distDir)) {
			const shouldClear = (
				(reloadCommands && key.includes("/commands/")) ||
				(reloadButtons && key.includes("/components/buttons/")) ||
				(reloadMenus && key.includes("/components/menus/")) ||
				(reloadEvents && key.includes("/events/")) ||
				(reloadConfigs && (key.includes("/config/") || key.includes("/service/")))
			);
			if (shouldClear) {
				delete require.cache[key];
				reloaded++;
			}
		}
	}

	// Reload commands
	if (reloadCommands) {
		const oldSize = client.commands.size;
		client.commands.clear();

		const commandsPath = path.join(distDir, "commands");
		if (fs.existsSync(commandsPath)) {
			for (const dir of fs.readdirSync(commandsPath)) {
				const dirPath = path.join(commandsPath, dir);
				if (!fs.statSync(dirPath).isDirectory()) continue;
				for (const file of fs
					.readdirSync(dirPath)
					.filter((file) => file.endsWith(".js") && !file.endsWith(".test.js") && !file.endsWith(".spec.js"))) {
					try {
						const cmdModule = require(path.join(dirPath, file));
						const command: CommandOptions = new cmdModule.default(client, file);
						command.category = dir;
						if (!client.commands.has(command.name)) {
							client.commands.set(command.name, command);
						}
					} catch (err) {
						console.error(`[hot-reload] Failed to load command ${dir}/${file}:`, err);
					}
				}
			}
		}
		console.log(`[hot-reload] Commands: ${oldSize} → ${client.commands.size}`);
	}

	// Reload buttons
	if (reloadButtons) {
		client.buttons.clear();
		const buttonsPath = path.join(distDir, "components", "buttons");
		if (fs.existsSync(buttonsPath)) {
			for (const file of fs.readdirSync(buttonsPath).filter(f => f.endsWith(".js"))) {
				try {
					const mod = require(path.join(buttonsPath, file));
					const component = new mod.default(client);
					client.buttons.set(component.id, component);
				} catch (err) {
					console.error(`[hot-reload] Failed to load button ${file}:`, err);
				}
			}
		}
		console.log(`[hot-reload] Buttons reloaded: ${client.buttons.size}`);
	}

	// Reload menus
	if (reloadMenus) {
		client.menus.clear();
		const menusPath = path.join(distDir, "components", "menus");
		if (fs.existsSync(menusPath)) {
			for (const file of fs.readdirSync(menusPath).filter(f => f.endsWith(".js"))) {
				try {
					const mod = require(path.join(menusPath, file));
					const component = new mod.default(client);
					client.menus.set(component.id, component);
				} catch (err) {
					console.error(`[hot-reload] Failed to load menu ${file}:`, err);
				}
			}
		}
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
export async function restoreMusicSessions(client: BaseClient): Promise<number> {
	let restored = 0;

	try {
		const raw = await client.redis.get(REDIS_MUSIC_KEY);
		if (!raw) return 0;

		const sessions: MusicSessionState[] = JSON.parse(raw);
		if (sessions.length === 0) return 0;

		console.log(`[hot-reload] Restoring ${sessions.length} music session(s)...`);

		for (const session of sessions) {
			try {
				if (!session.voiceChannelId || !session.track) continue;

				// Check if guild is accessible
				const guild = client.guilds.cache.get(session.guildId);
				if (!guild) continue;

				// Get a Lavalink node
				const nodes = client.manager.nodeManager.leastUsedNodes();
				const node = nodes[0];
				if (!node || !node.connected) continue;

				// Create or get player
				let player = client.manager.players.get(session.guildId);
				if (!player) {
					player = client.manager.createPlayer({
						guildId: session.guildId,
						voiceChannelId: session.voiceChannelId,
						textChannelId: session.textChannelId || undefined,
						selfDeaf: true,
						volume: session.volume,
						node: node.id,
					});
				}

				// Connect to voice
				await player.connect();

				// Play the saved track
				if (session.track) {
					await player.play({ encodedTrack: session.track });
					// Seek to saved position (with small offset for network delay)
					const seekTo = Math.max(0, session.position + (Date.now() - session.timestamp));
					if (seekTo > 0) {
						await player.seek(seekTo).catch(() => {});
					}
				}

				// Restore volume
				if (session.volume !== 100) {
					await player.setVolume(session.volume).catch(() => {});
				}

				// Restore pause state
				if (session.paused) {
					await player.pause().catch(() => {});
				}

				// Restore queue
				if (session.queue.length > 0) {
					for (const encoded of session.queue) {
						try {
							const result = await node.decode(encoded);
							if (result) {
								player.queue.add(result);
							}
						} catch {}
					}
				}

				restored++;
				console.log(`[hot-reload] Restored player for guild ${session.guildId}`);
			} catch (err) {
				console.error(`[hot-reload] Failed to restore session for ${session.guildId}:`, err);
			}
		}

		// Clear saved state after successful restoration
		if (restored > 0) {
			await client.redis.del(REDIS_MUSIC_KEY);
		}
	} catch (err) {
		console.error("[hot-reload] Error restoring music sessions:", err);
	}

	console.log(`[hot-reload] Restored ${restored} music session(s).`);
	return restored;
}
