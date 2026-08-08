import {
	EmbedBuilder,
	ButtonBuilder,
	ButtonStyle,
	ActionRowBuilder,
	ButtonInteraction,
} from 'discord.js';

/**
 * Confirmation View - Reusable confirmation dialog for dangerous actions
 */
export class ConfirmationView {
	private readonly timeout = 30000; // 30 seconds

	/**
	 * Create confirmation embed
	 */
	createConfirmation(data: {
		title: string;
		description: string;
		confirmLabel?: string;
		cancelLabel?: string;
		dangerous?: boolean;
	}): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] } {
		const embed = new EmbedBuilder()
			.setTitle(`⚠️ ${data.title}`)
			.setColor(data.dangerous ? 'Red' : 'Orange')
			.setDescription(data.description)
			.setFooter({ text: 'You have 30 seconds to confirm' });

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('confirm_yes')
				.setLabel(data.confirmLabel || 'Confirm')
				.setStyle(data.dangerous ? ButtonStyle.Danger : ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId('confirm_no')
				.setLabel(data.cancelLabel || 'Cancel')
				.setStyle(ButtonStyle.Secondary)
		);

		return { embed, components: [row] };
	}

	/**
	 * Handle confirmation interaction
	 */
	async handleConfirmation(
		interaction: ButtonInteraction,
		onConfirm: () => Promise<void>,
		onCancel?: () => Promise<void>
	): Promise<void> {
		const collector = interaction.channel?.createMessageComponentCollector({
			filter: (i) => i.user.id === interaction.user.id && ['confirm_yes', 'confirm_no'].includes(i.customId),
			time: this.timeout,
		});

		collector?.on('collect', (i) => {
			void (async () => {
				if (i.customId === 'confirm_yes') {
					await i.deferUpdate();
					await onConfirm();
					collector.stop('confirmed');
				} else {
					await i.deferUpdate();
					if (onCancel) await onCancel();
					collector.stop('cancelled');
				}
			})().catch(() => collector.stop('error'));
		});

		collector?.on('end', (_collected, reason) => {
			if (reason === 'time') {
				const embed = new EmbedBuilder()
					.setTitle('⏱️ Confirmation Timed Out')
					.setColor('Grey')
					.setDescription('The confirmation dialog has expired.');
				void interaction.editReply({ embeds: [embed], components: [] }).catch(() => undefined);
			}
		});
	}

	/**
	 * Quick confirmation helper
	 */
	static async ask(
		interaction: ButtonInteraction,
		title: string,
		description: string,
		dangerous = false
	): Promise<boolean> {
		const view = new ConfirmationView();
		const { embed, components } = view.createConfirmation({
			title,
			description,
			dangerous,
		});

		await interaction.reply({ embeds: [embed], components, ephemeral: true });

		return new Promise((resolve) => {
			const collector = interaction.channel?.createMessageComponentCollector({
				filter: (i) => i.user.id === interaction.user.id && ['confirm_yes', 'confirm_no'].includes(i.customId),
				time: view.timeout,
			});

			if (!collector) {
				resolve(false);
				return;
			}

			collector.on('collect', (i) => {
				void i.deferUpdate()
					.then(() => resolve(i.customId === 'confirm_yes'))
					.catch(() => resolve(false))
					.finally(() => collector.stop());
			});

			collector.on('end', () => {
				resolve(false);
			});
		});
	}
}

/**
 * Mass Action Confirmation - For bulk operations
 */
export class MassActionConfirmation {
	/**
	 * Create mass action confirmation with preview
	 */
	static createPreview(data: {
		title: string;
		action: string;
		count: number;
		preview: string[];
	}): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] } {
		const embed = new EmbedBuilder()
			.setTitle(`⚠️ ${data.title}`)
			.setColor('Red')
			.setDescription(
				`You are about to **${data.action}** for **${data.count}** items.\n\n` +
				`**Preview:**\n${data.preview.slice(0, 10).join('\n')}` +
				(data.count > 10 ? `\n... and ${data.count - 10} more` : '')
			)
			.setFooter({ text: 'This action cannot be undone' });

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('mass_confirm')
				.setLabel(`Confirm (${data.count})`)
				.setStyle(ButtonStyle.Danger),
			new ButtonBuilder()
				.setCustomId('mass_cancel')
				.setLabel('Cancel')
				.setStyle(ButtonStyle.Secondary)
		);

		return { embed, components: [row] };
	}
}
