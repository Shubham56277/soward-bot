export interface OfficialProfileBadge {
	key: string;
	label: string;
	mark: string;
	color: string;
}

export interface PublicUserFlagSource {
	has(flag: any): boolean;
}

const PUBLIC_BADGES: ReadonlyArray<readonly [string, OfficialProfileBadge]> = [
	["Staff", { key: "staff", label: "Discord Staff", mark: "S", color: "#5865f2" }],
	["Partner", { key: "partner", label: "Partnered Server Owner", mark: "P", color: "#5865f2" }],
	["Hypesquad", { key: "hypesquad-events", label: "HypeSquad Events", mark: "H", color: "#f47fff" }],
	["BugHunterLevel1", { key: "bug-hunter-1", label: "Discord Bug Hunter", mark: "B", color: "#3ba55c" }],
	["HypeSquadOnlineHouse1", { key: "house-bravery", label: "HypeSquad Bravery", mark: "B", color: "#9c84ef" }],
	["HypeSquadOnlineHouse2", { key: "house-brilliance", label: "HypeSquad Brilliance", mark: "R", color: "#f47b68" }],
	["HypeSquadOnlineHouse3", { key: "house-balance", label: "HypeSquad Balance", mark: "L", color: "#45ddc0" }],
	["PremiumEarlySupporter", { key: "early-supporter", label: "Early Supporter", mark: "E", color: "#f47fff" }],
	["BugHunterLevel2", { key: "bug-hunter-2", label: "Discord Bug Hunter Level 2", mark: "B2", color: "#f1c40f" }],
	["VerifiedBot", { key: "verified-bot", label: "Verified Bot", mark: "✓", color: "#5865f2" }],
	["VerifiedDeveloper", { key: "early-verified-developer", label: "Early Verified Bot Developer", mark: "D", color: "#5865f2" }],
	["CertifiedModerator", { key: "moderator-alumni", label: "Moderator Programs Alumni", mark: "M", color: "#5865f2" }],
	["ActiveDeveloper", { key: "active-developer", label: "Active Developer", mark: "A", color: "#5865f2" }],
];

export function mapOfficialProfileBadges(flags: PublicUserFlagSource | null | undefined, serverBooster = false): OfficialProfileBadge[] {
	const badges = flags ? PUBLIC_BADGES.filter(([flag]) => flags.has(flag)).map(([, badge]) => badge) : [];
	if (serverBooster) badges.push({ key: "server-booster", label: "Server Booster", mark: "◆", color: "#f47fff" });
	return badges;
}
export interface OfficialBadgeLayout {
	visible: OfficialProfileBadge[];
	overflow: number;
}

/** Fits fixed-size marks into a measured horizontal region and reserves room for a +N mark. */
export function layoutOfficialBadges(
	badges: readonly OfficialProfileBadge[],
	availableWidth: number,
	markWidth = 28,
	gap = 5,
	overflowWidth = 38,
): OfficialBadgeLayout {
	if (!badges.length || availableWidth < markWidth) return { visible: [], overflow: badges.length };
	const fullCapacity = Math.max(0, Math.floor((availableWidth + gap) / (markWidth + gap)));
	if (badges.length <= fullCapacity) return { visible: [...badges], overflow: 0 };
	const visibleCapacity = Math.max(0, Math.floor((availableWidth - overflowWidth + gap) / (markWidth + gap)));
	const visible = badges.slice(0, visibleCapacity);
	return { visible, overflow: badges.length - visible.length };
}

export function officialBadgeVersion(badges: readonly OfficialProfileBadge[]): string {
	return badges.map((badge) => badge.key).join(",") || "none";
}
