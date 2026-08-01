import {
	ProfileBadges,
	UserProfile,
	type BadgeDefinition,
	type CreateBadgeDefinitionInput,
	type GiveBadgeInput,
	type UpdateBadgeDefinitionInput,
	type UserBadge,
	type UserProfileData,
} from "@repo/db";
import { ProfileAssetLoader, profileAssetLoader } from "./ProfileAssetLoader";

export interface ProfileBadgeEntry {
	definition: BadgeDefinition;
	assignment: UserBadge | null;
	legacy: boolean;
}

export interface ProfileBadgeView {
	profile: UserProfileData;
	all: ProfileBadgeEntry[];
	visible: ProfileBadgeEntry[];
	overflow: number;
	versionToken: string;
}

const timestamp = (value: Date | string | null | undefined): number => value ? new Date(value).getTime() : 0;

export class ProfileBadgeService {
	public constructor(private readonly assets: ProfileAssetLoader = profileAssetLoader) {}

	public listDefinitions(): Promise<BadgeDefinition[]> {
		return ProfileBadges.list();
	}

	public list(): Promise<BadgeDefinition[]> {
		return this.listDefinitions();
	}

	public async activeAssigned(userId: string, visibleCap = 5): Promise<ProfileBadgeView> {
		const now = new Date();
		const [definitions, assigned, profile] = await Promise.all([
			ProfileBadges.list(),
			ProfileBadges.assigned(userId, now),
			UserProfile.get(userId),
		]);
		const active = definitions.filter((definition) =>
			definition.enabled && (!definition.expiresAt || timestamp(definition.expiresAt) > now.getTime()));
		const byKey = new Map(active.map((definition) => [definition.key, definition]));
		const entries = new Map<string, ProfileBadgeEntry>();
		for (const row of assigned) {
			if (byKey.has(row.definition.key)) {
				entries.set(row.definition.key, { definition: row.definition, assignment: row.assignment, legacy: false });
			}
		}
		// Legacy keys remain intact in UserProfile; this is an in-memory compatibility projection only.
		for (const key of profile.badges) {
			const definition = byKey.get(key);
			if (definition && !entries.has(key)) entries.set(key, { definition, assignment: null, legacy: true });
		}
		const all = [...entries.values()].sort((a, b) =>
			b.definition.sortPriority - a.definition.sortPriority || a.definition.key.localeCompare(b.definition.key));
		const cap = Math.max(0, Math.min(10, Math.trunc(visibleCap)));
		return {
			profile,
			all,
			visible: all.slice(0, cap),
			overflow: Math.max(0, all.length - cap),
			versionToken: this.versionToken(definitions, all, profile),
		};
	}

	public versionToken(definitions: BadgeDefinition[], entries: ProfileBadgeEntry[], profile: UserProfileData): string {
		const definitionPart = definitions
			.map((item) => `${item.key}:${item.version}:${timestamp(item.updatedAt)}`).sort().join(",");
		const assignmentPart = entries
			.map(({ definition, assignment, legacy }) => `${definition.key}:${assignment?.version ?? 0}:${timestamp(assignment?.updatedAt)}:${legacy ? 1 : 0}`)
			.sort().join(",");
		return `p:${timestamp(profile.updatedAt)}|d:${definitionPart}|a:${assignmentPart}`;
	}

	public async create(input: CreateBadgeDefinitionInput): Promise<BadgeDefinition> {
		if (!(await this.assets.isSafeBadgeAsset(input.asset))) throw new Error("Badge asset is unavailable or unsafe");
		return ProfileBadges.create(input);
	}

	public async edit(key: string, input: UpdateBadgeDefinitionInput, expectedVersion: number): Promise<BadgeDefinition> {
		if (input.asset && !(await this.assets.isSafeBadgeAsset(input.asset))) {
			throw new Error("Badge asset is unavailable or unsafe");
		}
		return ProfileBadges.update(key, input, expectedVersion);
	}

	public delete(key: string, expectedVersion: number): Promise<BadgeDefinition> {
		return ProfileBadges.delete(key, expectedVersion);
	}

	public give(userId: string, badgeKey: string, input: GiveBadgeInput = {}): Promise<UserBadge> {
		return ProfileBadges.give(userId, badgeKey, input);
	}

	public async remove(userId: string, badgeKey: string, expectedVersion?: number): Promise<boolean> {
		const [removed, profile] = await Promise.all([
			ProfileBadges.remove(userId, badgeKey, expectedVersion),
			UserProfile.get(userId),
		]);
		if (profile.badges.includes(badgeKey)) {
			await UserProfile.update(userId, { badges: profile.badges.filter((key) => key !== badgeKey) });
			return true;
		}
		return removed;
	}

	public async clear(userId: string): Promise<number> {
		const [removed, profile] = await Promise.all([ProfileBadges.clear(userId), UserProfile.get(userId)]);
		if (profile.badges.length) await UserProfile.update(userId, { badges: [] });
		return removed + profile.badges.length;
	}

	public show(userId: string, visibleCap = 5): Promise<ProfileBadgeView> {
		return this.activeAssigned(userId, visibleCap);
	}
}

export const profileBadgeService = new ProfileBadgeService();