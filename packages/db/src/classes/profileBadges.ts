import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "..";
import { User } from "./user";

export type BadgeAsset =
	| { kind: "remote"; url: string }
	| { kind: "local"; path: string };

export type BadgeDefinition = typeof schema.badgeDefinitions.$inferSelect;
export type UserBadge = typeof schema.userBadges.$inferSelect;

export interface CreateBadgeDefinitionInput {
	key: string;
	displayName: string;
	asset: BadgeAsset;
	description: string;
	sortPriority?: number;
	enabled?: boolean;
	type: "animated" | "static";
	expiresAt?: Date | null;
}

export interface UpdateBadgeDefinitionInput {
	displayName?: string;
	asset?: BadgeAsset;
	description?: string;
	sortPriority?: number;
	enabled?: boolean;
	type?: "animated" | "static";
	expiresAt?: Date | null;
}

export interface GiveBadgeInput {
	grantedBy?: string | null;
	grantMetadata?: Record<string, unknown>;
	expiresAt?: Date | null;
}

export class BadgeVersionConflictError extends Error {
	constructor(entity: "definition" | "assignment", expectedVersion: number) {
		super(`Badge ${entity} was not found or version ${expectedVersion} is stale`);
		this.name = "BadgeVersionConflictError";
	}
}

const toAssetColumns = (asset: BadgeAsset): { imageUrl: string | null; assetPath: string | null } => {
	if (asset.kind === "remote") {
		let url: URL;
		try {
			url = new URL(asset.url);
		} catch {
			throw new Error("Badge image URL must be a valid HTTPS URL");
		}
		if (url.protocol !== "https:") throw new Error("Badge image URL must use HTTPS");
		return { imageUrl: url.toString(), assetPath: null };
	}

	const path = asset.path.replaceAll("\\", "/");
	if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith("/") || path.split("/").includes("..")) {
		throw new Error("Badge asset path must be a safe project-relative path");
	}
	return { imageUrl: null, assetPath: path };
};

export class ProfileBadges {
	public static async list(): Promise<BadgeDefinition[]> {
		return db
			.select()
			.from(schema.badgeDefinitions)
			.orderBy(desc(schema.badgeDefinitions.sortPriority), asc(schema.badgeDefinitions.key));
	}

	public static async get(key: string): Promise<BadgeDefinition | null> {
		return (
			(await db.select().from(schema.badgeDefinitions).where(eq(schema.badgeDefinitions.key, key)).limit(1))[0] ?? null
		);
	}

	public static async create(input: CreateBadgeDefinitionInput): Promise<BadgeDefinition> {
		const { asset: assetInput, ...definition } = input;
		const asset = toAssetColumns(assetInput);
		return db.transaction(async (tx) => {
			const created = await tx
				.insert(schema.badgeDefinitions)
				.values({
					...definition,
					...asset,
				})
				.returning();

			const row = created[0];
			if (!row) throw new Error("Badge definition insert did not return a row");

			// Preserve the legacy array and only map exact keys that now have a definition.
			await tx.execute(sql`
				INSERT INTO ${schema.userBadges} (user_id, badge_key, grant_metadata)
				SELECT ${schema.userProfiles.userId}, ${input.key}, '{"source":"legacy_user_profiles"}'::jsonb
				FROM ${schema.userProfiles}
				WHERE ${input.key} = ANY(${schema.userProfiles.badges})
				ON CONFLICT (user_id, badge_key) DO NOTHING
			`);
			return row;
		});
	}

	public static async update(
		key: string,
		input: UpdateBadgeDefinitionInput,
		expectedVersion: number,
	): Promise<BadgeDefinition> {
		const { asset, ...changes } = input;
		const rows = await db
			.update(schema.badgeDefinitions)
			.set({
				...changes,
				...(asset ? toAssetColumns(asset) : {}),
				version: sql`${schema.badgeDefinitions.version} + 1`,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(schema.badgeDefinitions.key, key),
					eq(schema.badgeDefinitions.version, expectedVersion),
				),
			)
			.returning();
		if (!rows[0]) throw new BadgeVersionConflictError("definition", expectedVersion);
		return rows[0];
	}

	public static async delete(key: string, expectedVersion: number): Promise<BadgeDefinition> {
		const rows = await db
			.delete(schema.badgeDefinitions)
			.where(
				and(
					eq(schema.badgeDefinitions.key, key),
					eq(schema.badgeDefinitions.version, expectedVersion),
				),
			)
			.returning();
		if (!rows[0]) throw new BadgeVersionConflictError("definition", expectedVersion);
		return rows[0];
	}

	public static async assigned(userId: string, now = new Date()) {
		return db
			.select({ definition: schema.badgeDefinitions, assignment: schema.userBadges })
			.from(schema.userBadges)
			.innerJoin(schema.badgeDefinitions, eq(schema.userBadges.badgeKey, schema.badgeDefinitions.key))
			.where(
				and(
					eq(schema.userBadges.userId, userId),
					eq(schema.badgeDefinitions.enabled, true),
					or(isNull(schema.badgeDefinitions.expiresAt), gt(schema.badgeDefinitions.expiresAt, now)),
					or(isNull(schema.userBadges.expiresAt), gt(schema.userBadges.expiresAt, now)),
				),
			)
			.orderBy(desc(schema.badgeDefinitions.sortPriority), asc(schema.badgeDefinitions.key));
	}

	public static async give(userId: string, badgeKey: string, input: GiveBadgeInput = {}): Promise<UserBadge> {
		await User.get(userId);
		if (!(await ProfileBadges.get(badgeKey))) throw new Error(`Badge definition "${badgeKey}" does not exist`);

		const now = new Date();
		const rows = await db
			.insert(schema.userBadges)
			.values({
				userId,
				badgeKey,
				grantMetadata: input.grantMetadata ?? {},
				grantedBy: input.grantedBy ?? null,
				expiresAt: input.expiresAt ?? null,
				grantedAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [schema.userBadges.userId, schema.userBadges.badgeKey],
				set: {
					grantMetadata: input.grantMetadata ?? {},
					grantedBy: input.grantedBy ?? null,
					expiresAt: input.expiresAt ?? null,
					grantedAt: now,
					updatedAt: now,
					version: sql`${schema.userBadges.version} + 1`,
				},
			})
			.returning();
		if (!rows[0]) throw new Error("Badge assignment insert did not return a row");
		return rows[0];
	}

	public static async remove(userId: string, badgeKey: string, expectedVersion?: number): Promise<boolean> {
		const condition = expectedVersion === undefined
			? and(eq(schema.userBadges.userId, userId), eq(schema.userBadges.badgeKey, badgeKey))
			: and(
					eq(schema.userBadges.userId, userId),
					eq(schema.userBadges.badgeKey, badgeKey),
					eq(schema.userBadges.version, expectedVersion),
				);
		const rows = await db.delete(schema.userBadges).where(condition).returning();
		if (!rows[0] && expectedVersion !== undefined) {
			throw new BadgeVersionConflictError("assignment", expectedVersion);
		}
		return Boolean(rows[0]);
	}

	public static async clear(userId: string): Promise<number> {
		const rows = await db
			.delete(schema.userBadges)
			.where(eq(schema.userBadges.userId, userId))
			.returning({ badgeKey: schema.userBadges.badgeKey });
		return rows.length;
	}

	public static async show(userId: string) {
		return ProfileBadges.assigned(userId);
	}
}
