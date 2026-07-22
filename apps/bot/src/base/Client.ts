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
		this.cluster = new ClusterClient(this);
	}
	public async start(token: string): Promise<void> {
		this.redis = await createRedis();
		this.ai = new AiService(this.redis);
		this.commandCooldowns = new CommandCooldownService(this.redis);
		this.commandDeprecations = new CommandDeprecationService(this.redis);
		this.manager = new LavalinkClient(this);
		await this.loadCommands();
		this.logger.info("Successfully loaded commands!");
		await this.loadEvents();
		this.logger.info("Successfully loaded events!");
		this.loadComponents();
		await this.login(token);
		this.services = new Services(this);
		
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
	}

	private async loadCommands(): Promise<void> {
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
		const commandsPath = fs.readdirSync(path.join(process.cwd(), "dist", "commands"));

		for (const dir of commandsPath) {
			const commandFiles = fs.readdirSync(path.join(process.cwd(), "dist", "commands", dir)).filter((file) => file.endsWith(".js"));

			for (const file of commandFiles) {
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
	}
	private loadComponents() {
		const componentFolders = fs.readdirSync(path.join(process.cwd(), "dist", "components"));
		for (const component of componentFolders) {
			const componentPath = path.join(process.cwd(), "dist", "components", component);
			if (!fs.statSync(componentPath).isDirectory()) continue;
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
	}
	private loadButtons(componentFiles: string[]): void {
		for (const file of componentFiles) {
			const componentModule = require(path.join(process.cwd(), "dist", "components", "buttons", file));
			const component: ButtonOptions = new componentModule.default(this);
			this.buttons.set(component.id, component);
		}
		this.logger.info("Successfully loaded buttons!");
	}
    private loadMenus(componentFiles: string[]): void {
        for (const file of componentFiles) {
            const componentModule = require(path.join(process.cwd(), "dist", "components", "menus", file));
            const component: MenuOptions = new componentModule.default(this);
            this.menus.set(component.id, component);
        }
        this.logger.info("Successfully loaded menus!");
    }
	private async loadEvents(): Promise<void> {
		const eventsPath = fs.readdirSync(path.join(process.cwd(), "dist", "events"));

		for (const dir of eventsPath) {
			const eventFiles = fs.readdirSync(path.join(process.cwd(), "dist", "events", dir)).filter((file) => file.endsWith(".js"));

			for (const file of eventFiles) {
				const eventModule = require(path.join(process.cwd(), "dist", "events", dir, file));
				const event = new eventModule.default(this);

				void event.execute();
			}
		}
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
			await rest.put(route, { body: this.body });
			await this.redis.set(cacheKey, bodyHash, "EX", 7 * 24 * 60 * 60).catch(() => undefined);
			this.logger.info("Successfully deployed slash commands!");
		} catch (error) {
			this.logger.error(error);
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
