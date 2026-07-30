import { AFK } from "@repo/db";
import { Message, EmbedBuilder } from "discord.js";

export async function handleAfk(message: Message) {
	if (message.author.bot || message.author.system || !message.guild) return;

	// Handle user returning from AFK
	const userAfk = await AFK.get(message.author.id);
	if (userAfk) {
		// Check if this AFK applies to the current context
		const applies = userAfk.global || userAfk.guildId === message.guild.id;

		if (applies) {
			await AFK.delete(message.author.id);

			const welcomeEmbed = new EmbedBuilder().setColor(message.client.config.colors.main).setAuthor({
				name: `${message.author.username} is no longer AFK`,
				iconURL: message.author.displayAvatarURL(),
			});

			if (userAfk.mentionBy?.length) {
				const mentionList = userAfk.mentionBy.map((id) => `<@${id.id}>`).join(", ");
				welcomeEmbed.setDescription(`You were mentioned **${userAfk.mentionBy.length} time(s)** while you were away.\n\n**Mentioned by:** ${mentionList}`);
			} else {
				welcomeEmbed.setDescription("Welcome back! You weren't mentioned while you were away.");
			}

			await message.reply({
				embeds: [welcomeEmbed],
				allowedMentions: { repliedUser: false },
			}).catch(() => {});
			return;
		}
	}

	// Handle mentions of AFK users (runs regardless of author's AFK status)
	if (message.mentions.users.size === 0) return;

	for (const user of message.mentions.users.values()) {
		if (user.id === message.author.id) continue;
		if (user.bot) continue;
		if (user.system) continue;
		if (user.id === message.client.user?.id) continue;

		const afkUser = await AFK.get(user.id);
		if (!afkUser) continue;

		// Check if this AFK applies in the current guild
		const afkApplies = afkUser.global || afkUser.guildId === message.guild!.id;
		if (!afkApplies) continue;

		const afkEmbed = new EmbedBuilder()
			.setColor(message.client.config.colors.main)
			.setAuthor({
				name: `${user.username} is currently AFK`,
				iconURL: user.displayAvatarURL(),
			})
			.setDescription(afkUser.reason || "No reason provided")
			.setFooter({ text: "They'll be notified you mentioned them" });

		await message.reply({
			embeds: [afkEmbed],
			allowedMentions: { repliedUser: false },
		}).catch(() => {});

		await AFK.update(user.id, {
			mentionBy: afkUser.mentionBy ? [...afkUser.mentionBy, { id: message.author.id }] : [{ id: message.author.id }],
		});
	}
}
