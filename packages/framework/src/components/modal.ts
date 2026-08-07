import type { APIActionRowComponent, APIComponentInModalActionRow, APIModalInteractionResponseCallbackData } from "discord-api-types/v10";

export function createModal({
	customId,
	title,
	components,
}: {
	components: APIActionRowComponent<APIComponentInModalActionRow>[];
	customId: string;
	title: string;
}): APIModalInteractionResponseCallbackData {
	return {
		custom_id: customId,
		title,
		components,
	} as const;
}
