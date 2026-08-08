import { env } from "@repo/env";
import type { Redis } from "ioredis";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AiNode {
	id: string;               // e.g. "groq:0", "gemini:1"
	provider: "Groq" | "Gemini" | "OpenRouter" | "HuggingFace";
	model: string;
	apiKey: string;
	enabled: boolean;
	// Metrics (in-memory, fast)
	activeRequests: number;
	totalRequests: number;
	totalFailures: number;
	totalLatencyMs: number;
	cooldownUntil: number;    // timestamp, 0 = not on cooldown
	lastUsedAt: number;
}

export interface NodeMetrics {
	id: string;
	provider: string;
	model: string;
	enabled: boolean;
	activeRequests: number;
	avgLatencyMs: number;
	successRate: number;
	totalRequests: number;
	onCooldown: boolean;
	cooldownRemainingMs: number;
	healthScore: number;
}

// ─── Cluster Manager ───────────────────────────────────────────────────────

export class AiClusterManager {
	private nodes: AiNode[] = [];
	private readonly redis: Redis;

	constructor(redis: Redis) {
		this.redis = redis;
		this.buildNodes();
	}

	/** Build node list from env — backward compatible */
	private buildNodes(): void {
		this.nodes = [];

		// Groq nodes
		const groqEntries = this.parseKeyEntries(env.GROQ_API_KEYS, env.GROQ_API_KEY, env.GROQ_MODEL);
		for (const [index, entry] of groqEntries.entries()) {
			this.nodes.push(this.createNode(`groq:${index}`, "Groq", entry.model, entry.key));
		}

		// Gemini nodes
		const geminiEntries = this.parseKeyEntries(env.GEMINI_API_KEYS, env.GEMINI_API_KEY, env.GEMINI_MODEL);
		for (const [index, entry] of geminiEntries.entries()) {
			this.nodes.push(this.createNode(`gemini:${index}`, "Gemini", entry.model, entry.key));
		}

		// OpenRouter nodes
		const orEntries = this.parseKeyEntries(env.OPENROUTER_API_KEYS, env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL);
		for (const [index, entry] of orEntries.entries()) {
			this.nodes.push(this.createNode(`openrouter:${index}`, "OpenRouter", entry.model, entry.key));
		}

		// HuggingFace nodes
		const hfEntries = this.parseKeyEntries(env.HUGGINGFACE_TOKENS, env.HUGGINGFACE_TOKEN, env.HUGGINGFACE_MODEL);
		for (const [index, entry] of hfEntries.entries()) {
			this.nodes.push(this.createNode(`hf:${index}`, "HuggingFace", entry.model, entry.key));
		}
	}

	/** Parse key entries — supports strings, objects with key+model, or single fallback key */
	private parseKeyEntries(multiKeys: any[] | undefined, singleKey: string | undefined, defaultModel: string): Array<{ key: string; model: string }> {
		if (multiKeys && multiKeys.length > 0) {
			return multiKeys.map((entry) => {
				if (typeof entry === "string") return { key: entry, model: defaultModel };
				if (entry && typeof entry === "object" && entry.key) return { key: entry.key, model: entry.model || defaultModel };
				return null;
			}).filter((e): e is { key: string; model: string } => e !== null);
		}
		if (singleKey) return [{ key: singleKey, model: defaultModel }];
		return [];
	}

	private createNode(id: string, provider: AiNode["provider"], model: string, apiKey: string): AiNode {
		return {
			id, provider, model, apiKey, enabled: true,
			activeRequests: 0, totalRequests: 0, totalFailures: 0,
			totalLatencyMs: 0, cooldownUntil: 0, lastUsedAt: 0,
		};
	}

	/** Get the best available node using health-based scoring */
	public selectNode(preferProvider?: string): AiNode | null {
		const now = Date.now();
		const available = this.nodes.filter(n =>
			n.enabled && n.cooldownUntil < now
		);

		if (available.length === 0) return null;

		// If a specific provider is preferred, try it first
		if (preferProvider) {
			const preferred = available.filter(n => n.provider === preferProvider);
			if (preferred.length > 0) return this.pickBest(preferred);
		}

		return this.pickBest(available);
	}

	/** Score-based selection: higher score = better node */
	private pickBest(nodes: AiNode[]): AiNode {
		const [first, ...rest] = nodes;
		if (!first) throw new Error("Cannot select an AI node from an empty list");

		let best = first;
		let bestScore = this.healthScore(first);

		for (const node of rest) {
			const score = this.healthScore(node);
			if (score > bestScore) {
				best = node;
				bestScore = score;
			}
		}

		return best;
	}

	/** Health score: 0-100, higher is better */
	private healthScore(node: AiNode): number {
		const successRate = node.totalRequests > 0
			? (node.totalRequests - node.totalFailures) / node.totalRequests
			: 1;
		const avgLatency = node.totalRequests > 0
			? node.totalLatencyMs / node.totalRequests
			: 500;

		// Score components (all 0-1, higher is better)
		const latencyScore = Math.max(0, 1 - avgLatency / 10_000); // 0ms=1, 10000ms=0
		const successScore = successRate;
		const loadScore = Math.max(0, 1 - node.activeRequests / 10); // 0 active=1, 10+=0
		const freshnessScore = node.lastUsedAt === 0 ? 1 : Math.min(1, (Date.now() - node.lastUsedAt) / 60_000); // prefer nodes not used recently

		return Math.round((latencyScore * 25 + successScore * 40 + loadScore * 20 + freshnessScore * 15));
	}

	/** Record a successful request */
	public recordSuccess(nodeId: string, latencyMs: number): void {
		const node = this.nodes.find(n => n.id === nodeId);
		if (!node) return;
		node.activeRequests = Math.max(0, node.activeRequests - 1);
		node.totalRequests += 1;
		node.totalLatencyMs += latencyMs;
		node.lastUsedAt = Date.now();
	}

	/** Record a failed request and apply cooldown */
	public recordFailure(nodeId: string, statusCode?: number): void {
		const node = this.nodes.find(n => n.id === nodeId);
		if (!node) return;
		node.activeRequests = Math.max(0, node.activeRequests - 1);
		node.totalRequests += 1;
		node.totalFailures += 1;

		// Exponential backoff cooldown
		const consecutiveFailures = Math.min(node.totalFailures, 5);
		const cooldownMs = Math.min(60_000, 5_000 * Math.pow(2, consecutiveFailures - 1));

		// Rate limit (429) gets longer cooldown
		if (statusCode === 429) {
			node.cooldownUntil = Date.now() + Math.min(120_000, cooldownMs * 2);
		} else {
			node.cooldownUntil = Date.now() + cooldownMs;
		}
	}

	/** Mark a node as starting a request */
	public markActive(nodeId: string): void {
		const node = this.nodes.find(n => n.id === nodeId);
		if (node) {
			node.activeRequests += 1;
			node.lastUsedAt = Date.now();
		}
	}

	/** Get all node metrics (for ?aistatus command) */
	public getMetrics(): NodeMetrics[] {
		const now = Date.now();
		return this.nodes.map(node => ({
			id: node.id,
			provider: node.provider,
			model: node.model,
			enabled: node.enabled,
			activeRequests: node.activeRequests,
			avgLatencyMs: node.totalRequests > 0 ? Math.round(node.totalLatencyMs / node.totalRequests) : 0,
			successRate: node.totalRequests > 0 ? Math.round(((node.totalRequests - node.totalFailures) / node.totalRequests) * 100) : 100,
			totalRequests: node.totalRequests,
			onCooldown: node.cooldownUntil > now,
			cooldownRemainingMs: Math.max(0, node.cooldownUntil - now),
			healthScore: this.healthScore(node),
		}));
	}

	/** Get total node count */
	public get totalNodes(): number { return this.nodes.length; }

	/** Get available (not on cooldown) node count */
	public get availableNodes(): number {
		const now = Date.now();
		return this.nodes.filter(n => n.enabled && n.cooldownUntil < now).length;
	}

	/** Get a node by ID */
	public getNode(nodeId: string): AiNode | undefined {
		return this.nodes.find(n => n.id === nodeId);
	}

	/** Get all nodes for a provider */
	public getProviderNodes(provider: string): AiNode[] {
		return this.nodes.filter(n => n.provider === provider);
	}

	/** Check if any nodes are available */
	public get hasAvailableNodes(): boolean {
		return this.availableNodes > 0;
	}
}
