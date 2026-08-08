import {
	ContainerBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
} from "discord.js";

export const ANTINUKE_ARROW = "<a:arrow:1535258533900193792>";
export const ANTINUKE_TICK = "✅";
export const ANTINUKE_WARNING = "⚠️";
export const ANTINUKE_LOCK = "🔒";
export const ANTINUKE_OFF = "⏹️";

export type SetupProgress = {
	completed: number;
	active?: number;
	failure?: { index: number; message: string };
};

export function formatSetupProgress(steps: readonly string[], progress: SetupProgress): string {
	return steps.flatMap((step, index) => {
		if (progress.failure?.index === index) {
			return [`${ANTINUKE_WARNING} **${step} failed:** ${progress.failure.message}`];
		}
		if (index < progress.completed) return [`${ANTINUKE_TICK} ${step}`];
		if (index === progress.active) return [`${ANTINUKE_ARROW} **${step}**`];
		return [];
	}).join("\n");
}

export function buildAntiNukePanel(title: string, sections: readonly string[]): ContainerBuilder {
	const container = new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${title}**`));

	for (const section of sections.filter((value) => value.length > 0)) {
		container
			.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(section));
	}
	return container;
}
