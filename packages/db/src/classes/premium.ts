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
		if (!rawCode.trim() || !userId) return { status: "invalid" };
		const codeHash = hashCode(rawCode);
		const now = new Date();
		await User.get(userId);

		const result = await db.transaction(async (tx): Promise<PremiumCodeRedemption> => {
			const claimed = await tx
				.update(schema.premiumCodes)
				.set({ redeemedBy: userId, redeemedAt: now })
				.where(
					and(
						eq(schema.premiumCodes.codeHash, codeHash),
						isNull(schema.premiumCodes.redeemedAt),
						gt(schema.premiumCodes.expiresAt, now),
					),
				)
				.returning();

			const code = claimed[0];
			if (!code) {
				const existing = await tx
					.select({ redeemedAt: schema.premiumCodes.redeemedAt, expiresAt: schema.premiumCodes.expiresAt })
					.from(schema.premiumCodes)
					.where(eq(schema.premiumCodes.codeHash, codeHash))
					.limit(1);
				if (!existing[0]) return { status: "invalid" };
				if (existing[0].redeemedAt) return { status: "used" };
				return { status: "expired" };
			}

			const current = await tx.select().from(schema.premium).where(eq(schema.premium.userId, userId)).limit(1);
			const currentUntil = current[0]?.premiumUntil;
			const startsAt = currentUntil && currentUntil > now ? currentUntil : now;
			const premiumUntilMs = startsAt.getTime() + code.durationMs;
			if (!Number.isSafeInteger(premiumUntilMs)) throw new Error("Premium expiry exceeds the supported date range");
			const premiumUntil = new Date(premiumUntilMs);

			await tx
				.insert(schema.premium)
				.values({ userId, isPremium: true, premiumSince: now, premiumUntil, createdAt: now, updatedAt: now })
				.onConflictDoUpdate({
					target: schema.premium.userId,
					set: { isPremium: true, premiumSince: now, premiumUntil, updatedAt: now },
				});

			return { status: "redeemed", premiumUntil };
		});

		if (result.status === "redeemed") await invalidateCache(`db:premium:${userId}`);
		return result;
	}
}
