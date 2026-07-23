import { ActivityType, ApplicationCommandDataResolvable, ApplicationCommandType, Collection, PermissionsBitField, Routes } from "discord.js";
import Logger from "../lib/Logger";
import { ClusterClient, getInfo } from "discord-hybrid-sharding";
import { CommandOptions } from "../abstract/Command";
import LavalinkClient from "./lavalink/Manager";
import path from "node:path";
import fs from "node:fs";
import { createRedis, FrameWorkClient } from "@repo/framework";
import { constants } from "../config/constants";
import { rest } from "../bot";
import { env } from "@repo/env";
import { Redis } from "ioredis";
import { Services } from "../service";
import { ButtonOptions } from "../abstract/Button";
import { MenuOptions } from "../abstract/Menu";
import { installUiPolicy } from "../utils/uiPolicy";
import { createHash } from "node:crypto";
import { AiService } from "../service/aiService";
import { CommandCooldownService } from "../service/commandCooldownService";
import { CommandDeprecationService } from "../service/commandDeprecationService";
import { validateCommandRegistry, getRootCommandCount, printRegistrySummary } from "../config/commandRegistry";
import { validateLegacyCommandMap } from "../config/legacyCommandMap";

const backoffDelays = new Map();

function calculateBackoff(retryCount: number, baseDelay = 1000, maxDelay = 30000) {
	const exponentialDelay = Math.min(maxDelay, baseDelay * 2 ** retryCount);
	const jitter = Math.random() * baseDelay; // Add jitter to spread out retries
	return exponentialDelay + jitter;
}

export default class BaseClient extends FrameWorkClient {
	public logger: Logger = new Logger();
	public cooldown: Collection<string, any> = new Collection();
	public commands: Collection<string, CommandOptions> = new Collection();
	public aliases: Collection<string, string> = new Collection();
	public buttons: Collection<string, ButtonOptions> = new Collection();
	public menus: Collection<string, MenuOptions> = new Collection();
	public cluster: ClusterClient;
	public manager!: LavalinkClient;
	public config = constants;
	public redis!: Redis;
	public services!: Services;
	public ai!: AiService;
	public commandCooldowns!: CommandCooldownService;
	public commandDeprecations!: CommandDeprecationService;
	private body: ApplicationCommandDataResolvable[] = [];
	constructor() {
		console.log("[startup][BaseClient] constructor begin");
		installUiPolicy();
		super({
			intents: 53608447,
			shards: getInfo().SHARD_LIST,
			shardCount: getInfo().TOTAL_SHARDS,
			allowedMentions: { parse: ["users"], repliedUser: false },
			
			presence: {
				status: "idle",
				activities: [
					{
						type: ActivityType.Custom,
						name: "Custom Status",
						state: "🚀 Initializing systems...",
					},
				],
			},
		});
		console.log("[startup][BaseClient] discord.js client constructed");
		this.cluster = new ClusterClient(this);
		console.log("[startup][BaseClient] ClusterClient attached");
	}
	public async start(token: string): Promise<void> {
		this.logger.start("[startup] BaseClient.start begin");
		this.logger.debug(`[startup] token present=${Boolean(token)}`);
		this.logger.start("[startup] createRedis begin");
		this.redis = await createRedis();
		this.logger.success("[startup] createRedis complete");
		this.logger.start("[startup] AiService init begin");
		this.ai = new AiService(this.redis);
		this.logger.success("[startup] AiService init complete");
		this.logger.start("[startup] CommandCooldownService init begin");
		this.commandCooldowns = new CommandCooldownService(this.redis);
		this.logger.success("[startup] CommandCooldownService init complete");
		this.logger.start("[startup] CommandDeprecationService init begin");
		this.commandDeprecations = new CommandDeprecationService(this.redis);
		this.logger.success("[startup] CommandDeprecationService init complete");
		this.logger.start("[startup] LavalinkClient init begin");
		this.manager = new LavalinkClient(this);
		this.logger.success("[startup] LavalinkClient init complete");
		this.logger.start("[startup] loadCommands begin");
		await this.loadCommands();
		this.logger.success("[startup] loadCommands complete");
		this.logger.start("[startup] loadEvents begin");
		await this.loadEvents();
		this.logger.success("[startup] loadEvents complete");
		this.logger.start("[startup] loadComponents begin");
		this.loadComponents();
		this.logger.success("[startup] loadComponents complete");
		this.logger.start("[startup] client.login begin");
		await this.login(token);
		this.logger.success("[startup] client.login complete");
		this.on('ready', () => {
			this.logger.success('[startup] client ready');
		});
		this.logger.start("[startup] Services init begin");
		this.services = new Services(this);
		this.logger.success("[startup] Services init complete");
		
		this.logger.start("[startup] rateLimit listener registration begin");
		this.rest.on('rateLimited', async (info) => {
			const { method, route, global, retryAfter: timeout } = info;

			const key = global ? 'global' : route;

			const retryCount = backoffDelays.get(key) || 0;
			const delay = calculateBackoff(retryCount);

			this.logger.debug(`[RateLimit] ${global ? 'Global' : route} hit! Method: ${method}`);
			this.logger.debug(`→ Original Timeout: ${timeout}ms | Applying Backoff: ${delay.toFixed(0)}ms`);

			backoffDelays.set(key, retryCount + 1);

			await new Promise(resolve => setTimeout(resolve, delay));

			setTimeout(() => backoffDelays.delete(key), 60_000);
		});
		this.logger.success("[startup] rateLimit listener registration complete");
	}

	private async loadCommands(): Promise<void> {
		this.logger.start("[startup] loadCommands: registry validation begin");
		// Print registry summary for diagnostics
		printRegistrySummary();

		const registryErrors = [...validateCommandRegistry(), ...validateLegacyCommandMap()];
		if (registryErrors.length > 0) {
			throw new Error(`Command registry validation failed:\n${registryErrors.join("\n")}`);
		}

		// Reject if too many root commands (safety check before Discord sync)
		const rootCount = getRootCommandCount();
		if (rootCount > 90 && env.NODE_ENV !== "development") {
			throw new Error(`Root application-command count (${rootCount}) exceeds 90. Refusing to start.`);
		}
		this.logger.info(`Registry: ${rootCount} root commands will be registered.`);
		this.logger.debug("[startup] loadCommands: reading dist/commands");
		const commandsPath = fs.readdirSync(path.join(process.cwd(), "dist", "commands"));
		this.logger.debug(`[startup] loadCommands: found ${commandsPath.length} command groups`);

		for (const dir of commandsPath) {
			this.logger.debug(`[startup] loadCommands: scanning group ${dir}`);
			const commandFiles = fs.readdirSync(path.join(process.cwd(), "dist", "commands", dir)).filter((file) => file.endsWith(".js"));

			for (const file of commandFiles) {
				this.logger.debug(`[startup] loadCommands: loading ${dir}/${file}`);
				const cmdModule = require(path.join(process.cwd(), "dist", "commands", dir, file));
				const command: CommandOptions = new cmdModule.default(this, file);
				command.category = dir;

				if (this.commands.has(command.name)) {
					throw new Error(`Duplicate command name detected: ${command.name}`);
				}
				this.commands.set(command.name, command);
				if (command.slashCommand) {
					const data: ApplicationCommandDataResolvable = {
						name: command.name,
						description: command.description?.content ?? "",
						contexts: command.contexts!,
						integration_types: command.integration_types!,
						type: ApplicationCommandType.ChatInput,
						options: command.options || [],
						default_member_permissions:
							Array.isArray(command.permissions?.user) && command.permissions?.user.length > 0 ? PermissionsBitField.resolve(command.permissions?.user as any).toString() : null,
					};
					this.body.push(data);
				}
				if (command.context?.enabled) {
					const types = Array.isArray(command.context.type) ? command.context.type : [command.context.type]; // Ensure it's always an array

					for (const type of types) {
						const data: ApplicationCommandDataResolvable = {
							name: command.context.name,
							type,
							default_member_permissions: Array.isArray(command.permissions?.user) && command.permissions.user.length > 0 ? PermissionsBitField.resolve(command.permissions.user).toString() : null,
						};
						this.body.push(data);
					}
				}
			}
		}

		this.logger.log(`Slash commands to deploy: ${this.body.length}`);
		if (this.body.length > 100) {
			throw new Error(`Discord application-command limit exceeded: ${this.body.length}/100`);
		}
		this.logger.success("[startup] loadCommands: complete");
	}
	private loadComponents() {
		this.logger.start("[startup] loadComponents: reading dist/components");
		const componentFolders = fs.readdirSync(path.join(process.cwd(), "dist", "components"));
		for (const component of componentFolders) {
			const componentPath = path.join(process.cwd(), "dist", "components", component);
			if (!fs.statSync(componentPath).isDirectory()) continue;
			this.logger.debug(`[startup] loadComponents: scanning ${component}`);
			const componentFiles = fs.readdirSync(componentPath).filter((file) => file.endsWith(".js"));
			switch (component) {
				case "buttons":
					this.loadButtons(componentFiles);
					break;
				case "menus":
					this.loadMenus(componentFiles);
					break;
				default:
					break;
			}
		}
		this.logger.success("[startup] loadComponents: complete");
	}
	private loadButtons(componentFiles: string[]): void {
		this.logger.start(`[startup] loadButtons begin (${componentFiles.length} files)`);
		for (const file of componentFiles) {
			this.logger.debug(`[startup] loadButtons: loading ${file}`);
			const componentModule = require(path.join(process.cwd(), "dist", "components", "buttons", file));
			const component: ButtonOptions = new componentModule.default(this);
			this.buttons.set(component.id, component);
		}
		this.logger.success("[startup] loadButtons complete");
	}
    private loadMenus(componentFiles: string[]): void {
        this.logger.start(`[startup] loadMenus begin (${componentFiles.length} files)`);
        for (const file of componentFiles) {
            this.logger.debug(`[startup] loadMenus: loading ${file}`);
            const componentModule = require(path.join(process.cwd(), "dist", "components", "menus", file));
            const component: MenuOptions = new componentModule.default(this);
            this.menus.set(component.id, component);
        }
        this.logger.success("[startup] loadMenus complete");
    }
	private async loadEvents(): Promise<void> {
		this.logger.start("[startup] loadEvents: reading dist/events");
		const eventsPath = fs.readdirSync(path.join(process.cwd(), "dist", "events"));
		this.logger.debug(`[startup] loadEvents: found ${eventsPath.length} event groups`);

		for (const dir of eventsPath) {
			this.logger.debug(`[startup] loadEvents: scanning group ${dir}`);
			const eventFiles = fs.readdirSync(path.join(process.cwd(), "dist", "events", dir)).filter((file) => file.endsWith(".js"));

			for (const file of eventFiles) {
				this.logger.debug(`[startup] loadEvents: loading ${dir}/${file}`);
				const eventModule = require(path.join(process.cwd(), "dist", "events", dir, file));
				const event = new eventModule.default(this);

				void event.execute();
			}
		}
		this.logger.success("[startup] loadEvents: complete");
	}

	public async deployCommands(guildId?: string): Promise<void> {
		const route = guildId ? Routes.applicationGuildCommands(env.DISCORD_APP_CLIENT_ID ?? "", guildId) : Routes.applicationCommands(env.DISCORD_APP_CLIENT_ID ?? "");

		// Log final count before sync
		this.logger.info(`Deploying ${this.body.length} application command(s) to ${guildId ? `guild ${guildId}` : "global"}.`);
		const bodyHash = createHash("sha256").update(JSON.stringify(this.body)).digest("hex");
		const cacheKey = `discord:commands:${env.DISCORD_APP_CLIENT_ID}:${guildId ?? "global"}:hash`;
		try {
			if ((await this.redis.get(cacheKey).catch(() => null)) === bodyHash) {
				this.logger.info("Slash commands are unchanged; deployment skipped.");
				return;
			}
			this.logger.start(`[startup] deployCommands begin target=${guildId ? `guild ${guildId}` : "global"}`);
			await rest.put(route, { body: this.body });
			await this.redis.set(cacheKey, bodyHash, "EX", 7 * 24 * 60 * 60).catch(() => undefined);
			this.logger.success("[startup] deployCommands complete");
		} catch (error) {
			this.logger.error("[startup] deployCommands failed");
			this.logger.error(error);
			throw error;
		}
	}
}

declare module "discord.js" {
	interface Client {
		commands: Collection<string, CommandOptions>;
		aliases: Collection<string, string>;
		config: typeof constants;
	}
}
