import { ActivityType, ApplicationCommandDataResolvable, ApplicationCommandType, Collection, PermissionsBitField, Routes } from "discord.js";
import Logger from "../lib/Logger";
import { ClusterClient, getInfo } from "discord-hybrid-sharding";
import { CommandOptions } from "../abstract/Command";
import LavalinkClient from "./lavalink/Manager";
import path from "node:path";
import fs from "node:fs";
import { createRedis, FrameWorkClient } from "@repo/framework";
import { constants } from "../config/constants";
import { env } from "@repo/env";
import { Redis } from "ioredis";
import { Services } from "../service";
import { ButtonOptions } from "../abstract/Button";
import { MenuOptions } from "../abstract/Menu";
import { createHash } from "node:crypto";
import { AiService } from "../service/aiService";
import { KnowledgeBase } from "../service/knowledgeBase";
import { RagService } from "../service/ragService";
import { AnalyticsRecorder } from "../service/analyticsRecorder";
import { ResponseFormatter } from "../service/responseFormatter";
import { HELP_CATEGORIES } from "../config/helpArchitecture";
import { CommandCooldownService } from "../service/commandCooldownService";
import { CommandDeprecationService } from "../service/commandDeprecationService";
import { validateCommandRegistry, getRootCommandCount, normalizeRegistryKey, printRegistrySummary } from "../config/commandRegistry";
import { validateLegacyCommandMap } from "../config/legacyCommandMap";
import { uninstallHotReloadHandlers } from "../modules/hotReload";
import { stopMusicProgressUpdater } from "../utils/musicProgressUpdater";
import { initQueues, shutdownQueues } from "../queues";

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
	public rag!: RagService;
	public commandCooldowns!: CommandCooldownService;
	public commandDeprecations!: CommandDeprecationService;
	private body: ApplicationCommandDataResolvable[] = [];
	private readonly backoffDelays = new Map<string, number>();
	private readonly rateLimitResetTimers = new Map<string, NodeJS.Timeout>();
	private rateLimitListener: ((info: any) => void) | undefined;
	constructor() {
		console.log("[startup][BaseClient] constructor begin");
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
						state: "Initializing systems...",
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
		let knowledgeBaseRebuilt = false;
		const rebuildKnowledgeBase = (): void => {
			if (knowledgeBaseRebuilt || !this.rag) return;
			const kb = (this.rag as any).kb;
			if (!kb) return;
			knowledgeBaseRebuilt = true;
			kb.rebuild(this.commands, HELP_CATEGORIES);
			this.logger.success(`[startup] Knowledge Base rebuilt: ${kb.size} documents indexed`);
		};
		this.once("clientReady", () => {
			this.logger.success("[startup] client ready");
			rebuildKnowledgeBase();
		});

		this.logger.start("[startup] Services init begin");
		this.services = new Services(this);
		this.logger.success("[startup] Services init complete");

		this.logger.start("[startup] KnowledgeBase + RagService init begin");
		const analyticsRecorder = new AnalyticsRecorder(this.redis);
		const kb = new KnowledgeBase(this.redis);
		const formatter = new ResponseFormatter();
		this.rag = new RagService(this.ai, kb, this.redis, analyticsRecorder, formatter);
		this.logger.success("[startup] KnowledgeBase + RagService init complete");

		this.logger.start("[startup] AiClusterManager init begin");
		const { AiClusterManager } = require("../service/aiClusterManager");
		(this as any).aiCluster = new AiClusterManager(this.redis);
		this.ai.setCluster((this as any).aiCluster);
		this.logger.success(`[startup] AiClusterManager init complete: ${(this as any).aiCluster.totalNodes} nodes`);
		
		this.logger.start("[startup] rateLimit listener registration begin");
		this.rateLimitListener = (info): void => {
			const { method, route, global, retryAfter: timeout } = info;
			const key = global ? "global" : route;
			const retryCount = this.backoffDelays.get(key) ?? 0;
			const delay = calculateBackoff(retryCount);

			this.logger.debug(`[RateLimit] ${global ? "Global" : route} hit! Method: ${method}`);
			this.logger.debug(`→ Original Timeout: ${timeout}ms | Applying Backoff: ${delay.toFixed(0)}ms`);
			this.backoffDelays.set(key, retryCount + 1);

			const previousTimer = this.rateLimitResetTimers.get(key);
			if (previousTimer) clearTimeout(previousTimer);
			const resetTimer = setTimeout(() => {
				this.backoffDelays.delete(key);
				this.rateLimitResetTimers.delete(key);
			}, Math.max(60_000, delay));
			resetTimer.unref();
			this.rateLimitResetTimers.set(key, resetTimer);
		};
		this.rest.on("rateLimited", this.rateLimitListener);
		this.logger.success("[startup] rateLimit listener registration complete");

		this.logger.start("[startup] client.login begin");
		await this.login(token);
		this.logger.success("[startup] client.login complete");
		rebuildKnowledgeBase();

		this.logger.start("[startup] Queue system init begin");
		await initQueues(this);
		this.logger.success("[startup] Queue system init complete");
	}

	private async loadCommands(): Promise<void> {
		this.logger.start("[startup] loadCommands: registry validation begin");
		printRegistrySummary();

		const registryErrors = [...validateCommandRegistry(), ...validateLegacyCommandMap()].sort();
		if (registryErrors.length > 0) {
			throw new Error(`Command registry validation failed:\n${registryErrors.join("\n")}`);
		}

		const rootCount = getRootCommandCount();
		if (rootCount > 90 && env.NODE_ENV !== "development") {
			throw new Error(`Root application-command count (${rootCount}) exceeds 90. Refusing to start.`);
		}
		this.logger.info(`Registry: ${rootCount} root commands will be registered.`);

		const commands = new Collection<string, CommandOptions>();
		const aliases = new Collection<string, string>();
		const claimedNames = new Map<string, string>();
		const applicationCommandKeys = new Map<string, string>();
		const body: ApplicationCommandDataResolvable[] = [];
		const commandsRoot = path.join(process.cwd(), "dist", "commands");
		const commandGroups = fs.readdirSync(commandsRoot).sort();
		this.logger.debug(`[startup] loadCommands: found ${commandGroups.length} command groups`);

		const claimApplicationCommand = (name: string, type: ApplicationCommandType, source: string): void => {
			const key = `${type}:${normalizeRegistryKey(name)}`;
			const existing = applicationCommandKeys.get(key);
			if (existing) throw new Error(`Duplicate application command "${name}" (type ${type}) from ${source}; already registered by ${existing}`);
			applicationCommandKeys.set(key, source);
		};

		for (const dir of commandGroups) {
			const groupPath = path.join(commandsRoot, dir);
			if (!fs.statSync(groupPath).isDirectory()) continue;
			this.logger.debug(`[startup] loadCommands: scanning group ${dir}`);
			const commandFiles = fs.readdirSync(groupPath)
				.filter((file) => file.endsWith(".js") && !file.endsWith(".test.js") && !file.endsWith(".spec.js"))
				.sort();

			for (const file of commandFiles) {
				const source = `${dir}/${file}`;
				this.logger.debug(`[startup] loadCommands: loading ${source}`);
				const cmdModule = require(path.join(groupPath, file));
				const command: CommandOptions = new cmdModule.default(this, file);
				command.category = dir;
				const commandName = normalizeRegistryKey(command.name);
				if (!commandName) throw new Error(`Command from ${source} has an empty name`);

				const existingName = claimedNames.get(commandName);
				if (existingName) throw new Error(`Command name collision: "${command.name}" from ${source} conflicts with ${existingName}`);
				claimedNames.set(commandName, `command "${command.name}" from ${source}`);
				commands.set(commandName, command);

				for (const rawAlias of command.aliases ?? []) {
					const alias = normalizeRegistryKey(rawAlias);
					if (!alias) throw new Error(`Command "${command.name}" has an empty alias in ${source}`);
					const existingAlias = claimedNames.get(alias);
					if (existingAlias) throw new Error(`Command alias collision: "${rawAlias}" for "${command.name}" from ${source} conflicts with ${existingAlias}`);
					claimedNames.set(alias, `alias "${rawAlias}" for "${command.name}" from ${source}`);
					aliases.set(alias, commandName);
				}

				if (command.slashCommand) {
					claimApplicationCommand(command.name, ApplicationCommandType.ChatInput, source);
					body.push({
						name: command.name,
						description: command.description?.content ?? "",
						contexts: command.contexts!,
						integration_types: command.integration_types!,
						type: ApplicationCommandType.ChatInput,
						options: command.options || [],
						default_member_permissions:
							Array.isArray(command.permissions?.user) && command.permissions.user.length > 0
								? PermissionsBitField.resolve(command.permissions.user as any).toString()
								: null,
					});
				}

				if (command.context?.enabled) {
					const types = Array.isArray(command.context.type) ? command.context.type : [command.context.type];
					for (const type of types) {
						claimApplicationCommand(command.context.name, type, source);
						body.push({
							name: command.context.name,
							type,
							default_member_permissions:
								Array.isArray(command.permissions?.user) && command.permissions.user.length > 0
									? PermissionsBitField.resolve(command.permissions.user).toString()
									: null,
						});
					}
				}
			}
		}

		this.logger.log(`Slash commands to deploy: ${body.length}`);
		if (body.length > 100) throw new Error(`Discord application-command limit exceeded: ${body.length}/100`);

		this.commands.clear();
		this.aliases.clear();
		for (const [name, command] of commands) this.commands.set(name, command);
		for (const [alias, commandName] of aliases) this.aliases.set(alias, commandName);
		this.body = body;
		this.logger.success(`[startup] loadCommands complete: ${commands.size} commands, ${aliases.size} aliases`);
	}
	private loadComponents() {
		this.logger.start("[startup] loadComponents: reading dist/components");
		const componentFolders = fs.readdirSync(path.join(process.cwd(), "dist", "components")).sort();
		for (const component of componentFolders) {
			const componentPath = path.join(process.cwd(), "dist", "components", component);
			if (!fs.statSync(componentPath).isDirectory()) continue;
			this.logger.debug(`[startup] loadComponents: scanning ${component}`);
			const componentFiles = fs.readdirSync(componentPath).filter((file) => file.endsWith(".js")).sort();
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
			if (this.buttons.has(component.id)) throw new Error(`Duplicate button component ID "${component.id}" in ${file}`);
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
            if (this.menus.has(component.id)) throw new Error(`Duplicate menu component ID "${component.id}" in ${file}`);
            this.menus.set(component.id, component);
        }
        this.logger.success("[startup] loadMenus complete");
    }
	private async loadEvents(): Promise<void> {
		this.logger.start("[startup] loadEvents: reading dist/events");
		const eventsPath = fs.readdirSync(path.join(process.cwd(), "dist", "events")).sort();
		this.logger.debug(`[startup] loadEvents: found ${eventsPath.length} event groups`);

		for (const dir of eventsPath) {
			this.logger.debug(`[startup] loadEvents: scanning group ${dir}`);
			const eventFiles = fs.readdirSync(path.join(process.cwd(), "dist", "events", dir)).filter((file) => file.endsWith(".js")).sort();

			for (const file of eventFiles) {
				this.logger.debug(`[startup] loadEvents: loading ${dir}/${file}`);
				const eventModule = require(path.join(process.cwd(), "dist", "events", dir, file));
				const event = new eventModule.default(this);

				await event.execute();
			}
		}
		this.logger.success("[startup] loadEvents: complete");
	}

	public override async destroy(): Promise<void> {
		uninstallHotReloadHandlers(this);
		stopMusicProgressUpdater(this);
		await shutdownQueues();
		if (this.rateLimitListener) {
			this.rest.off("rateLimited", this.rateLimitListener);
			this.rateLimitListener = undefined;
		}
		for (const timer of this.rateLimitResetTimers.values()) clearTimeout(timer);
		this.rateLimitResetTimers.clear();
		this.backoffDelays.clear();
		await super.destroy();
		if (this.redis && this.redis.status !== "end") await this.redis.quit();
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
			await this.rest.put(route, { body: this.body });
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
