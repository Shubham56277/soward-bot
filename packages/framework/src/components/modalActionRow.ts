import { type APIActionRowComponent, type APIComponentInModalActionRow, ComponentType } from "discord-api-types/v10";

export function createModalActionRow(
    components: APIComponentInModalActionRow[],
): APIActionRowComponent<APIComponentInModalActionRow> {
    return {
        type: ComponentType.ActionRow,
        components,
    } as const;
}
