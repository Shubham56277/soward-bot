import { createHash } from "node:crypto";
import type { Collection } from "discord.js";
import type { Redis } from "ioredis";
import type { CommandOptions } from "../abstract/Command";
import type { Category } from "../config/helpArchitecture";
import { COMMAND_REGISTRY_BY_NAME } from "../config/commandRegistry";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface CommandDoc {
	name: string;
	label: string;
	description: string;
	category: string;
	usage: string;
	examples: string[];
	permissions: {
		user: string[];
		client: string[];
	};
	premium: boolean;
	subcommands: string[];
	keywords: string[];
	aliases: string[];
	relatedCommands: string[];
}

export interface ModuleDoc {
	key: string;
	label: string;
	category: string;
	description: string;
	commands: string[];
	groups: Array<{ heading: string; commands: string[] }>;
	premium: boolean;
}

export interface FaqDoc {
	id: string;
	category: string;
	question: string;
	answer: string;
	relatedCommands: string[];
}

export interface KnowledgeDocument {
	id: string;
	type: "command" | "module" | "faq";
	name: string;
	category: string;
	content: string;
	metadata: CommandDoc | ModuleDoc | FaqDoc;
}

export interface SearchResult {
	document: KnowledgeDocument;
	relevanceScore: number;
}

export interface KnowledgeBaseConfig {
	confidenceThreshold: number;
	maxResults: number;
	minResults: number;
	cacheTtlSeconds: number;
}

// ─── Stop words and stemming ─────────────────────────────────────────────────

const STOP_WORDS = new Set([
	"a", "the", "is", "in", "on", "for", "to", "of", "and",
	"how", "do", "i", "what", "can",
]);

function stem(word: string): string {
	if (word.length <= 3) return word;
	if (word.endsWith("tion")) return word.slice(0, -4);
	if (word.endsWith("ment")) return word.slice(0, -4);
	if (word.endsWith("ing")) return word.slice(0, -3);
	if (word.endsWith("ly")) return word.slice(0, -2);
	if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
	if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return word.slice(0, -1);
	return word;
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\w\s]/g, "")
		.split(/\s+/)
		.filter((t) => t.length > 0 && !STOP_WORDS.has(t))
		.map(stem);
}

// ─── TF-IDF Index (internal) ─────────────────────────────────────────────────

interface TfIdfIndex {
	df: Map<string, number>;
	tfVectors: Map<string, Map<string, number>>;
	documentCount: number;
	idf: Map<string, number>;
}

// ─── KnowledgeBase Class ─────────────────────────────────────────────────────

export class KnowledgeBase {
	private documents: Map<string, KnowledgeDocument> = new Map();
	private index: TfIdfIndex = { df: new Map(), tfVectors: new Map(), documentCount: 0, idf: new Map() };
	private readonly redis: Redis;
	private readonly config: KnowledgeBaseConfig;
	private readonly cachePrefix = "ai:rag:cache:";

	constructor(redis: Redis, config?: Partial<KnowledgeBaseConfig>) {
		this.redis = redis;
		this.config = {
			confidenceThreshold: config?.confidenceThreshold ?? 0.15,
			maxResults: config?.maxResults ?? 5,
			minResults: config?.minResults ?? 3,
			cacheTtlSeconds: config?.cacheTtlSeconds ?? 300,
		};
	}

	/** Rebuild the entire index from command registry + help architecture categories */
	public rebuild(commands: Collection<string, CommandOptions>, categories: Category[]): void {
		this.documents.clear();
		this.index = { df: new Map(), tfVectors: new Map(), documentCount: 0, idf: new Map() };

		// Index commands
		for (const [, cmd] of commands) {
			const registryEntry = COMMAND_REGISTRY_BY_NAME.get(cmd.name);
			const subcommands = cmd.options
				?.filter((o) => o.type === 1 || o.type === 2) // SUB_COMMAND or SUB_COMMAND_GROUP
				.map((o) => o.name) ?? registryEntry?.subcommands ?? [];

			const keywords = registryEntry?.keywords ?? [];
			const aliases = registryEntry?.legacyNames ?? [];
			const label = registryEntry?.label ?? cmd.name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

			const commandDoc: CommandDoc = {
				name: cmd.name,
				label,
				description: cmd.description?.content ?? "No description provided",
				category: cmd.category ?? "general",
				usage: cmd.description?.usage ?? cmd.name,
				examples: cmd.description?.examples ?? [],
				permissions: {
					user: (cmd.permissions?.user as string[] | undefined) ?? [],
					client: (cmd.permissions?.client as string[] | undefined) ?? [],
				},
				premium: cmd.premium ?? false,
				subcommands,
				keywords,
				aliases,
				relatedCommands: [],
			};

			// Build searchable content from all fields
			const contentParts = [
				cmd.name,
				label,
				commandDoc.description,
				commandDoc.usage,
				...commandDoc.examples,
				commandDoc.category,
				...subcommands,
				...keywords,
				...aliases,
				...(commandDoc.permissions.user),
				...(commandDoc.permissions.client),
			];

			const doc: KnowledgeDocument = {
				id: `cmd:${cmd.name}`,
				type: "command",
				name: cmd.name,
				category: commandDoc.category,
				content: contentParts.join(" "),
				metadata: commandDoc,
			};

			this.documents.set(doc.id, doc);
		}

		// Index module docs from helpArchitecture categories
		for (const category of categories) {
			for (const feature of category.features) {
				if (feature.comingSoon) continue;

				const allCommands: string[] = [];
				for (const group of feature.groups) {
					allCommands.push(...group.commands);
				}

				const moduleDoc: ModuleDoc = {
					key: feature.key,
					label: feature.label,
					category: category.key,
					description: feature.description,
					commands: allCommands,
					groups: feature.groups.map((g) => ({ heading: g.heading, commands: [...g.commands] })),
					premium: feature.premium ?? false,
				};

				const contentParts = [
					feature.key,
					feature.label,
					feature.description,
					category.key,
					category.label,
					category.tagline,
					...allCommands,
					...feature.groups.map((g) => g.heading),
				];

				const doc: KnowledgeDocument = {
					id: `mod:${feature.key}`,
					type: "module",
					name: feature.label,
					category: category.key,
					content: contentParts.join(" "),
					metadata: moduleDoc,
				};

				this.documents.set(doc.id, doc);
			}

			// Generate FAQ entries for each category
			const faqDoc: FaqDoc = {
				id: `faq:${category.key}`,
				category: category.key,
				question: `What features are available in the ${category.label} category?`,
				answer: `The ${category.label} category (${category.tagline}) includes: ${category.features
					.filter((f) => !f.comingSoon)
					.map((f) => `${f.label} - ${f.description}`)
					.join("; ")}`,
				relatedCommands: category.features.flatMap((f) => f.groups.flatMap((g) => g.commands)),
			};

			const faqContent = [
				faqDoc.question,
				faqDoc.answer,
				category.key,
				category.label,
				category.tagline,
				...faqDoc.relatedCommands,
			].join(" ");

			const doc: KnowledgeDocument = {
				id: `faq:${category.key}`,
				type: "faq",
				name: `${category.label} FAQ`,
				category: category.key,
				content: faqContent,
				metadata: faqDoc,
			};

			this.documents.set(doc.id, doc);
		}

		// Build TF-IDF index
		this.buildIndex();
	}

	/** Search documents by query, returns scored results ordered by descending relevance */
	public search(query: string, maxResults?: number): SearchResult[] {
		const max = maxResults ?? this.config.maxResults;
		const tokens = tokenize(query);
		if (tokens.length === 0) return [];

		// Check Redis cache
		const cacheKey = this.getCacheKey(query, max);
		// Note: cache check is async but search is sync for simplicity.
		// Cache is utilized via the async searchCached method or populated after sync search.

		// Compute query TF vector
		const queryTf = new Map<string, number>();
		for (const token of tokens) {
			queryTf.set(token, (queryTf.get(token) ?? 0) + 1);
		}

		// Compute TF-IDF weighted query vector
		const queryVector = new Map<string, number>();
		for (const [term, tf] of queryTf) {
			const idf = this.index.idf.get(term) ?? 0;
			if (idf > 0) {
				queryVector.set(term, tf * idf);
			}
		}

		if (queryVector.size === 0) return [];

		// Compute cosine similarity against all documents
		const results: SearchResult[] = [];
		const queryMagnitude = Math.sqrt(
			[...queryVector.values()].reduce((sum, v) => sum + v * v, 0),
		);

		if (queryMagnitude === 0) return [];

		for (const [docId, docTfVector] of this.index.tfVectors) {
			let dotProduct = 0;
			let docMagnitude = 0;

			for (const [term, docWeight] of docTfVector) {
				const idf = this.index.idf.get(term) ?? 0;
				const tfidf = docWeight * idf;
				docMagnitude += tfidf * tfidf;
				const queryWeight = queryVector.get(term);
				if (queryWeight !== undefined) {
					dotProduct += tfidf * queryWeight;
				}
			}

			docMagnitude = Math.sqrt(docMagnitude);
			if (docMagnitude === 0 || dotProduct === 0) continue;

			const similarity = dotProduct / (queryMagnitude * docMagnitude);
			const document = this.documents.get(docId);
			if (document && similarity > 0) {
				results.push({ document, relevanceScore: Math.min(1.0, similarity) });
			}
		}

		// Sort by descending relevance score
		results.sort((a, b) => b.relevanceScore - a.relevanceScore);

		const bounded = results.slice(0, max);

		// Async cache population (fire and forget)
		this.cacheResults(cacheKey, bounded).catch(() => {});

		return bounded;
	}

	/** Get a specific document by ID */
	public getDocument(id: string): KnowledgeDocument | undefined {
		return this.documents.get(id);
	}

	/** Get all documents for a category */
	public getByCategory(category: string): KnowledgeDocument[] {
		const results: KnowledgeDocument[] = [];
		for (const doc of this.documents.values()) {
			if (doc.category === category) {
				results.push(doc);
			}
		}
		return results;
	}

	/** Get total document count */
	public get size(): number {
		return this.documents.size;
	}

	/** Invalidate all cached query results */
	public async invalidateCache(): Promise<void> {
		const pattern = `${this.cachePrefix}*`;
		let cursor = "0";
		do {
			const [nextCursor, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
			cursor = nextCursor;
			if (keys.length > 0) {
				await this.redis.del(...keys);
			}
		} while (cursor !== "0");
	}

	// ─── Private Methods ─────────────────────────────────────────────────────

	private buildIndex(): void {
		const df = new Map<string, number>();
		const tfVectors = new Map<string, Map<string, number>>();

		for (const [docId, doc] of this.documents) {
			const tokens = tokenize(doc.content);
			const termFreq = new Map<string, number>();

			for (const token of tokens) {
				termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
			}

			// Normalize TF by document length
			const docLength = tokens.length || 1;
			const normalizedTf = new Map<string, number>();
			for (const [term, count] of termFreq) {
				normalizedTf.set(term, count / docLength);
			}

			tfVectors.set(docId, normalizedTf);

			// Track document frequency
			const seenTerms = new Set(tokens);
			for (const term of seenTerms) {
				df.set(term, (df.get(term) ?? 0) + 1);
			}
		}

		// Compute IDF values: log(N / df)
		const documentCount = this.documents.size;
		const idf = new Map<string, number>();
		for (const [term, freq] of df) {
			idf.set(term, Math.log(documentCount / freq));
		}

		this.index = { df, tfVectors, documentCount, idf };
	}

	private getCacheKey(query: string, maxResults: number): string {
		const hash = createHash("sha256").update(`${query.toLowerCase().trim()}:${maxResults}`).digest("hex");
		return `${this.cachePrefix}${hash}`;
	}

	private async cacheResults(key: string, results: SearchResult[]): Promise<void> {
		try {
			const serializable = results.map((r) => ({
				documentId: r.document.id,
				relevanceScore: r.relevanceScore,
			}));
			await this.redis.set(key, JSON.stringify(serializable), "EX", this.config.cacheTtlSeconds);
		} catch {
			// Cache write failure is non-critical
		}
	}
}
