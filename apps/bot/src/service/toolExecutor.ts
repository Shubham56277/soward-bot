import type { Redis } from "ioredis";
import type { KnowledgeBase } from "./knowledgeBase";

const logger = {
	error: (msg: string, meta?: Record<string, unknown>) => {
		console.error(`[ToolExecutor] ${msg}`, meta ?? "");
	},
};

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface ToolCallRequest {
	name: string;
	arguments: Record<string, unknown>;
}

export interface ToolCallResult {
	name: string;
	result: string;
	error?: string;
}

export interface ToolContext {
	guildId: string;
	userId: string;
	channelId: string;
}

// ─── Sensitive field patterns ──────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
	/api[_-]?key/i,
	/token/i,
	/secret/i,
	/password/i,
	/authorization/i,
	/connection[_-]?string/i,
	/dsn/i,
	/private[_-]?key/i,
	/system[_-]?prompt/i,
	/webhook[_-]?url/i,
];

// ─── ToolExecutor ──────────────────────────────────────────────────────────────

export class ToolExecutor {
	public constructor(
		private readonly kb: KnowledgeBase,
		private readonly redis: Redis,
	) {}

	/** Execute a tool call with guild-scoped context */
	public async execute(call: ToolCallRequest, context: ToolContext): Promise<ToolCallResult> {
		try {
			const result = await this.dispatch(call, context);
			return { name: call.name, result: JSON.stringify(this.sanitize(result)) };
		} catch (error) {
			const message = error instanceof Error ? error.message : "Tool temporarily unavailable";
			logger.error(`Tool execution failed: ${call.name}`, {
				tool: call.name,
				guildId: context.guildId,
				userId: context.userId,
				error: message,
			});
			return { name: call.name, result: JSON.stringify({ error: "Tool temporarily unavailable" }), error: message };
		}
	}

	/** Sanitize tool output to remove sensitive fields */
	public sanitize(output: Record<string, unknown>): Record<string, unknown> {
		const sanitized: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(output)) {
			if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(key))) continue;
			if (value && typeof value === "object" && !Array.isArray(value)) {
				sanitized[key] = this.sanitize(value as Record<string, unknown>);
			} else {
				sanitized[key] = value;
			}
		}
		return sanitized;
	}

	// ─── Private Dispatch ────────────────────────────────────────────────────

	private async dispatch(call: ToolCallRequest, context: ToolContext): Promise<Record<string, unknown>> {
		switch (call.name) {
			case "search_commands":
				return this.searchCommands(call.arguments, context);
			case "search_documentation":
				return this.searchDocumentation(call.arguments, context);
			case "get_command_details":
				return this.getCommandDetails(call.arguments, context);
			case "get_module_info":
				return this.getModuleInfo(call.arguments, context);
			case "get_guild_config":
				return this.getGuildConfig(call.arguments, context);
			case "check_permissions":
				return this.checkPermissions(call.arguments, context);
			default:
				return { error: `Unknown tool: ${call.name}` };
		}
	}

	private searchCommands(args: Record<string, unknown>, _context: ToolContext): Record<string, unknown> {
		const keyword = String(args.keyword ?? "");
		if (!keyword) return { results: [] };

		const results = this.kb.search(keyword, 5)
			.filter((r) => r.document.type === "command")
			.map((r) => ({
				name: r.document.name,
				category: r.document.category,
				description: (r.document.metadata as any).description ?? "",
				relevance: r.relevanceScore,
			}));

		return { results };
	}

	private searchDocumentation(args: Record<string, unknown>, _context: ToolContext): Record<string, unknown> {
		const topic = String(args.topic ?? "");
		if (!topic) return { results: [] };

		const results = this.kb.search(topic, 5)
			.filter((r) => r.document.type === "module" || r.document.type === "faq")
			.map((r) => ({
				name: r.document.name,
				type: r.document.type,
				category: r.document.category,
				content: (r.document.metadata as any).description ?? (r.document.metadata as any).answer ?? "",
			}));

		return { results };
	}

	private getCommandDetails(args: Record<string, unknown>, _context: ToolContext): Record<string, unknown> {
		const commandName = String(args.command_name ?? "");
		if (!commandName) return { error: "command_name is required" };

		const doc = this.kb.getDocument(`cmd:${commandName}`);
		if (!doc) return { error: `Command '${commandName}' not found` };

		return this.sanitize(doc.metadata as unknown as Record<string, unknown>);
	}

	private getModuleInfo(args: Record<string, unknown>, _context: ToolContext): Record<string, unknown> {
		const moduleKey = String(args.module_key ?? "");
		if (!moduleKey) return { error: "module_key is required" };

		const doc = this.kb.getDocument(`mod:${moduleKey}`);
		if (!doc) return { error: `Module '${moduleKey}' not found` };

		return this.sanitize(doc.metadata as unknown as Record<string, unknown>);
	}

	private async getGuildConfig(args: Record<string, unknown>, context: ToolContext): Promise<Record<string, unknown>> {
		// Guild isolation: reject if a guild_id argument is provided that differs from the context
		if (args.guild_id && String(args.guild_id) !== context.guildId) {
			logger.error("Guild isolation violation: attempted access to foreign guild config", {
				requestedGuildId: String(args.guild_id),
				contextGuildId: context.guildId,
				userId: context.userId,
			});
			return { error: "Access denied: cannot access configuration for a different guild" };
		}

		const key = `guild:config:${context.guildId}`;
		try {
			const raw = await this.redis.get(key);
			if (!raw) return { guildId: context.guildId, modules: [], note: "No custom configuration found" };
			const config = JSON.parse(raw);
			return this.sanitize(config as Record<string, unknown>);
		} catch {
			return { guildId: context.guildId, modules: [], note: "Unable to load config" };
		}
	}

	private async checkPermissions(args: Record<string, unknown>, context: ToolContext): Promise<Record<string, unknown>> {
		const commandName = String(args.command_name ?? "");
		const userId = String(args.user_id ?? context.userId);
		if (!commandName) return { error: "command_name is required" };

		const doc = this.kb.getDocument(`cmd:${commandName}`);
		if (!doc) return { error: `Command '${commandName}' not found` };

		const metadata = doc.metadata as any;
		return {
			command: commandName,
			userId,
			guildId: context.guildId,
			requiredPermissions: metadata.permissions ?? { user: [], client: [] },
			premium: metadata.premium ?? false,
			note: "Permission check is informational — actual enforcement happens at runtime.",
		};
	}
}
