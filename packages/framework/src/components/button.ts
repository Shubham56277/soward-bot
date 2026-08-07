import { type APIButtonComponent, type APIMessageComponentEmoji, ButtonStyle, ComponentType } from "discord-api-types/v10";

type InteractiveButtonStyle = Exclude<ButtonStyle, ButtonStyle.Link | ButtonStyle.Premium>;
type ButtonBaseOptions = {
	disabled?: boolean;
	emoji?: APIMessageComponentEmoji;
	label: string;
};

export type CreateButtonOptions = ButtonBaseOptions & ({ customId: string; style?: InteractiveButtonStyle; url?: never } | { customId?: never; style: ButtonStyle.Link; url: string });

export function createButton(options: CreateButtonOptions): APIButtonComponent {
	const common = {
		type: ComponentType.Button as const,
		label: options.label,
		disabled: options.disabled,
		emoji: options.emoji,
	};

	if (options.style === ButtonStyle.Link) {
		return {
			...common,
			style: ButtonStyle.Link,
			url: options.url,
		};
	}

	return {
		...common,
		style: options.style ?? ButtonStyle.Primary,
		custom_id: options.customId,
	};
}
