import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "..";
import { User } from "./user";
import { invalidateCache } from "../cache";

const CODE_PREFIX = "SWRD";
const DEFAULT_CODE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

const hashCode = (code: string) => createHash("sha256").update(code.trim().toUpperCase()).digest("hex");

export type PremiumCodeRedemption =
	| { status: "redeemed"; premiumUntil: Date }
	| { status: "invalid" | "used" | "expired" };

export class PremiumCode {
	public static async create(durationMs: number, createdBy: string, codeLifetimeMs = DEFAULT_CODE_LIFETIME_MS) {
		if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new Error("Premium duration must be positive");
		if (!Number.isSafeInteger(codeLifetimeMs) || codeLifetimeMs <= 0) throw new Error("Code lifetime must be positive");

		const code = `${CODE_PREFIX}-${randomBytes(16).toString("hex").toUpperCase()}`;
		const expiresAt = new Date(Date.now() + codeLifetimeMs);

		await db.insert(schema.premiumCodes).values({
			codeHash: hashCode(code),
			durationMs,
			createdBy,
			expiresAt,
		});

		return { code, expiresAt };
	}

	public static async redeem(rawCode: string, userId: string): Promise<PremiumCodeRedemption> {
		const codeHash = hashCode(rawCode);
		const now = new Date();
		const code = (await db.select().from(schema.premiumCodes).where(eq(schema.premiumCodes.codeHash, codeHash)).limit(1)).at(0);

		if (!code) return { status: "invalid" };
		if (code.redeemedAt) return { status: "used" };
		if (code.expiresAt <= now) return { status: "expired" };

		const claimed = await db
			.update(schema.premiumCodes)
			.set({ redeemedBy: userId, redeemedAt: now })
			.where(and(eq(schema.premiumCodes.codeHash, codeHash), isNull(schema.premiumCodes.redeemedAt), gt(schema.premiumCodes.expiresAt, now)))
			.returning();

		if (claimed.length === 0) return { status: "used" };

		try {
			await User.get(userId);
			const current = await db.select().from(schema.premium).where(eq(schema.premium.userId, userId)).limit(1);
			const currentUntil = current.at(0)?.premiumUntil;
			const startsAt = currentUntil && currentUntil > now ? currentUntil : now;
			const premiumUntil = new Date(startsAt.getTime() + code.durationMs);

			await db
				.insert(schema.premium)
				.values({ userId, isPremium: true, premiumSince: now, premiumUntil, createdAt: now, updatedAt: now })
				.onConflictDoUpdate({
					target: schema.premium.userId,
					set: { isPremium: true, premiumSince: now, premiumUntil, updatedAt: now },
				});
			await invalidateCache(`db:premium:${userId}`);

			return { status: "redeemed", premiumUntil };
		} catch (error) {
			await db
				.update(schema.premiumCodes)
				.set({ redeemedBy: null, redeemedAt: null })
				.where(and(eq(schema.premiumCodes.codeHash, codeHash), eq(schema.premiumCodes.redeemedBy, userId)));
			throw error;
		}
	}
}
