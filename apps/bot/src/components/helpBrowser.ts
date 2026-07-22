import {
	EmbedBuilder,
	ButtonBuilder,
	ButtonStyle,
	ActionRowBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuInteraction,
	ButtonInteraction,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	ChannelType,
} from 'discord.js';
import type { Lavamusic } from '../structures/Client';

/**
 * Help Browser - Interactive help system with search and navigation
 */
export class HelpBrowser {
	private client: Lavamusic;
	private readonly timeout = 120000; // 2 minutes

	constructor(client: Lavamusic) {
		this.client = client;
	}

	/**
	 * Create main help embed
	 */
	createMainHelp(): { embed: EmbedBuilder; components: ActionRowBuilder[] } {
		const embed = new EmbedBuilder()
			.setTitle('📚 Help Menu')
			.setColor('Blue')
			.setDescription(
				'Welcome to the help menu! Use the buttons below to navigate through different command categories.'
			)
			.addFields(
				{ name: '🔍 Search', value: 'Click the search button to find specific commands', inline: true },
				{ name: '📋 Categories', value: 'Browse commands by category', inline: true },
				{ name: 'ℹ️ Stats', value: `${this.client.commands.size} commands available`, inline: true },
			)
			.setFooter({ text: 'Use the menu below to navigate' });

		const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId('help_category')
				.setPlaceholder('Select a category')
				.addOptions([
					{ label: '🛠️ Moderation', value: 'moderation', description: 'Moderation commands' },
					{ label: '🎵 Music', value: 'music', description: 'Music playback commands' },
					{ label: '🔒 Security', value: 'security', description: 'Security and AntiNuke' },
					{ label: '⚙️ Settings', value: 'settings', description: 'Bot configuration' },
					{ label: '🎉 Giveaways', value: 'giveaways', description: 'Giveaway commands' },
					{ label: '🎫 Tickets', value: 'ticket', description: 'Ticket system' },
					{ label: '📋 Utility', value: 'utils', description: 'Utility commands' },
					{ label: '🎭 Fun', value: 'fun', description: 'Fun commands' },
				])
		);

		const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('help_search')
				.setLabel('Search')
				.setStyle(ButtonStyle.Primary)
				.setEmoji('🔍'),
			new ButtonBuilder()
				.setCustomId('help_home')
				.setLabel('Home')
				.setStyle(ButtonStyle.Secondary)
				.setEmoji('🏠'),
			new ButtonBuilder()
				.setCustomId('help_invite')
				.setLabel('Invite')
				.setStyle(ButtonStyle.Link)
				.setURL(this.client.config.inviteUrl || 'https://discord.com'),
		);

		return { embed, components: [row1, row2] };
	}

	/**
	 * Create category help embed
	 */
	createCategoryHelp(category: string): { embed: EmbedBuilder; components: ActionRowBuilder[] } {
		const commands = this.client.commands.filter(cmd => cmd.category === category);
		
		const embed = new EmbedBuilder()
			.setTitle(`📚 ${category.charAt(0).toUpperCase() + category.slice(1)} Commands`)
			.setColor('Blue')
			.setDescription(commands.map(cmd => `**/${cmd.name}** - ${cmd.description}`).join('\n') || 'No commands in this category')
			.setFooter({ text: `${commands.size} commands • Use the menu to browse other categories` });

		const row1 = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId('help_category')
				.setPlaceholder('Select a category')
				.addOptions([
					{ label: '🛠️ Moderation', value: 'moderation', description: 'Moderation commands', default: category === 'moderation' },
					{ label: '🎵 Music', value: 'music', description: 'Music playback commands', default: category === 'music' },
					{ label: '🔒 Security', value: 'security', description: 'Security and AntiNuke', default: category === 'security' },
					{ label: '⚙️ Settings', value: 'settings', description: 'Bot configuration', default: category === 'settings' },
					{ label: '🎉 Giveaways', value: 'giveaways', description: 'Giveaway commands', default: category === 'giveaways' },
					{ label: '🎫 Tickets', value: 'ticket', description: 'Ticket system', default: category === 'ticket' },
					{ label: '📋 Utility', value: 'utils', description: 'Utility commands', default: category === 'utils' },
					{ label: '🎭 Fun', value: 'fun', description: 'Fun commands', default: category === 'fun' },
				])
		);

		const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('help_search')
				.setLabel('Search')
				.setStyle(ButtonStyle.Primary)
				.setEmoji('🔍'),
			new ButtonBuilder()
				.setCustomId('help_home')
				.setLabel('Home')
				.setStyle(ButtonStyle.Secondary)
				.setEmoji('🏠'),
		);

		return { embed, components: [row1, row2] };
	}

	/**
	 * Create command help embed
	 */
	createCommandHelp(commandName: string): EmbedBuilder | null {
		const command = this.client.commands.get(commandName);
		if (!command) return null;

		const embed = new EmbedBuilder()
			.setTitle(`📖 /${command.name}`)
			.setColor('Blue')
			.setDescription(command.description)
			.addFields({ name: 'Category', value: command.category || 'Unknown', inline: true });

		if (command.permissions && command.permissions.length > 0) {
			embed.addFields({ name: 'Required Permissions', value: command.permissions.join(', '), inline: true });
		}

		if (command.subcommands && command.subcommands.length > 0) {
			embed.addFields({
				name: 'Subcommands',
				value: command.subcommands.map(sub => `**${sub.name}** - ${sub.description}`).join('\n'),
			});
		}

		embed.setFooter({ text: `Use /${command.name} to run this command` });

		return embed;
	}

	/**
	 * Create search modal
	 */
	createSearchModal(): ModalBuilder {
		const modal = new ModalBuilder()
			.setCustomId('help_search_modal')
			.setTitle('Search Commands');

		const searchInput = new TextInputBuilder()
			.setCustomId('search_query')
			.setLabel('Enter command name or keyword')
			.setStyle(TextInputStyle.Short)
			.setPlaceholder('e.g., ban, music, ticket')
			.setRequired(true)
			.setMaxLength(50);

		const row = new ActionRowBuilder<TextInputBuilder>().addComponents(searchInput);
		modal.addComponents(row);

		return modal;
	}

	/**
	 * Search commands by query
	 */
	searchCommands(query: string): EmbedBuilder {
		const lowerQuery = query.toLowerCase();
		const results = this.client.commands.filter(cmd => 
			cmd.name.toLowerCase().includes(lowerQuery) ||
			cmd.description.toLowerCase().includes(lowerQuery) ||
			cmd.category?.toLowerCase().includes(lowerQuery)
		);

		if (results.size === 0) {
			return new EmbedBuilder()
				.setTitle('🔍 Search Results')
				.setColor('Red')
				.setDescription(`No commands found matching "${query}"`);
		}

		const embed = new EmbedBuilder()
			.setTitle('🔍 Search Results')
			.setColor('Blue')
			.setDescription(
				results
					.map(cmd => `**/${cmd.name}** - ${cmd.description}`)
					.slice(0, 25)
					.join('\n')
			)
			.setFooter({ text: `${results.size} result(s) found` });

		return embed;
	}

	/**
	 * Handle interaction
	 */
	async handleInteraction(interaction: StringSelectMenuInteraction | ButtonInteraction): Promise<void> {
		if (interaction.isStringSelectMenu()) {
			if (interaction.customId === 'help_category') {
				const category = interaction.values[0];
				const { embed, components } = this.createCategoryHelp(category);
				await interaction.update({ embeds: [embed], components });
			}
		} else if (interaction.isButton()) {
			if (interaction.customId === 'help_home') {
				const { embed, components } = this.createMainHelp();
				await interaction.update({ embeds: [embed], components });
			} else if (interaction.customId === 'help_search') {
				const modal = this.createSearchModal();
				await interaction.showModal(modal);
			}
		}
	}
}
