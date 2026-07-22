import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { IsUrl } from "../../utils/helper";

export default class Addemoji extends Command {
	constructor() {
		super({
			name: "addemoji",
			description: {
				content: "Add an emoji to the this server",
				examples: ["addemoji"],
				usage: "addemoji",
			},
			category: "utils",
			aliases: ["steal"],
			cooldown: 5,
			args: false,
			player: {
				voice: false,
				active: false,
			},
			permissions: {
				dev: false,
				client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"],
				user: ["ManageEmojisAndStickers"],
			},
			slashCommand: true,
			options: [
				{
					name: "emoji",
					description: "The emoji to add",
					type: 3,
					required: true,
				},
				{
					name: "name",
					description: "The name of the emoji",
					type: 3,
					required: false,
				},
			],
		});
	}
	public async run(ctx: Context): Promise<any> {
		let input = ctx.args.join(" ");
		if (ctx.interaction) {
			input = ctx.interaction.options.getString("emoji") ?? "";
		}

		const replied_message = ctx.message?.reference;

		let sticker: {
			name: string;
			tags: string | null;
		} | null = null;
		if (replied_message) {
			// check is emojis have in this reply message
			const msg = await ctx.channel.messages.fetch(replied_message?.messageId ?? "");

			let replied_message_content = msg.content;
			if (msg.attachments.size > 0) {
				replied_message_content = msg.attachments.first()?.url || "";
			}
			if (msg.stickers.size > 0) {
				const stickers = await ctx.client.fetchSticker(msg.stickers.first()!.id);
				replied_message_content = stickers.url || "";

				sticker = {
					name: stickers.name,
					tags: stickers.tags
				}
			}

			input = `${replied_message_content}`;
		}
		if (!input) {
			return ctx.editOrReply({ content: "Please provide at least one custom emoji to add." });
		}
		if (IsUrl(input)) {
			// from url
			if (sticker) {

				const getEmbed = (added = false) =>
					new EmbedBuilder()
						.setTitle(added ? "<:Tick:1375519268292264012> Emoji Added!" : "Add This Emoji?")
						.setColor(ctx.client.config.colors.main)
						.setImage(input)

				const getButtons = (disabled = false) =>
					new ActionRowBuilder<ButtonBuilder>().addComponents(
						new ButtonBuilder().setCustomId("add").setLabel("✨ Add Emoji").setStyle(ButtonStyle.Success).setDisabled(disabled),
						new ButtonBuilder().setCustomId("add_sticker").setLabel("✨ Add Sticker").setStyle(ButtonStyle.Success).setDisabled(disabled),
					);

				const message = await ctx.editOrReply({
					embeds: [getEmbed()],
					components: [getButtons()],
				});

				const collector = message.createMessageComponentCollector({
					componentType: ComponentType.Button,
					time: 60000,
				});

				collector.on("collect", async (i) => {
					if (i.user.id !== ctx.author?.id) return i.reply({ content: "This interaction isn't for you.", flags: MessageFlags.Ephemeral });
					if (i.customId === "add") {
						const emoji = await ctx.guild.emojis.create({ name: "emoji", attachment: input });
						return i.update({
							embeds: [
								new EmbedBuilder()
									.setTitle("<:Tick:1375519268292264012> Emoji Added!")
									.setColor(ctx.client.config.colors.main)
									.setImage(emoji.imageURL())
									.setFooter({ text: `Requested by ${ctx.author?.tag}`, iconURL: ctx.author?.displayAvatarURL() })
									.setTimestamp(),
							],
							components: [],
						});
					} if (i.customId === "add_sticker") {
						let buffer: ArrayBuffer | null = null;
						try {
							buffer = await fetch(input).then((res) => res.arrayBuffer());
						} catch (_e) {
							return i.reply({ content: "Failed to fetch sticker from URL.", flags: MessageFlags.Ephemeral });
						}
						const boostLevel = ctx.guild.premiumTier;
						if (boostLevel === 0 && ctx.guild.stickers.cache.size >= 5) {
							return i.reply({ content: "You have reached the sticker limit for level 0 servers.", flags: MessageFlags.Ephemeral });
						}
						if (boostLevel === 1 && ctx.guild.stickers.cache.size >= 15) {
							return i.reply({ content: "You have reached the sticker limit for level 1 servers.", flags: MessageFlags.Ephemeral });
						}
						if (boostLevel === 2 && ctx.guild.stickers.cache.size >= 30) {
							return i.reply({ content: "You have reached the sticker limit for level 2 servers.", flags: MessageFlags.Ephemeral });
						}
						if (boostLevel === 3 && ctx.guild.stickers.cache.size >= 60) {
							return i.reply({ content: "You have reached the sticker limit for level 3 servers.", flags: MessageFlags.Ephemeral });
						}

						const sticke = await ctx.guild.stickers.create({
							name: sticker.name,
							file: Buffer.from(buffer ?? new ArrayBuffer(0)),
							tags: sticker.tags ?? ":liked:",
						});
						return i.update({
							embeds: [
								new EmbedBuilder()
									.setTitle("<:Tick:1375519268292264012> Sticker Added!")
									.setColor(ctx.client.config.colors.main)
									.setImage(sticke.url)
									.setFooter({ text: `Requested by ${ctx.author?.tag}`, iconURL: ctx.author?.displayAvatarURL() })
									.setTimestamp(),
							],
							components: [],
						});
					}
				});

				collector.on("end", () => {
					message.edit({ components: [getButtons(true)] }).catch(() => null);
				});
			}
			const emoji = await ctx.guild.emojis.create({ name: "emoji", attachment: input });
			return ctx.editOrReply({
				embeds: [
					new EmbedBuilder()
						.setTitle("Emoji Added!")
						.setColor(ctx.client.config.colors.main)
						.setImage(emoji.imageURL())
						.setFooter({ text: `Requested by ${ctx.author?.tag}`, iconURL: ctx.author?.displayAvatarURL() })
						.setTimestamp(),
				],
			});
		}

		const customEmojis = input.match(/<a?:\w+:\d+>/g);
		if (!customEmojis || customEmojis.length === 0) {
			return ctx.editOrReply({ content: "No valid custom emojis found in your input." });
		}
		let index = 0;
		const emojis = customEmojis
			.map((emoji: string) => {
				const match = emoji.match(/<(a?):(\w+):(\d+)>/);
				if (!match) return null;
				const [, animated, name, id] = match;
				const ext = animated ? "gif" : "png";
				const url = `https://cdn.discordapp.com/emojis/${id}.${ext}`;
				return { id, name, animated, url };
			})
			.filter(Boolean) as { id: string; name: string; animated: string; url: string }[];

		const getEmbed = (added = false) =>
			new EmbedBuilder()
				.setTitle(added ? "<:Tick:1375519268292264012> Emoji Added!" : "Add This Emoji?")
				.setColor(ctx.client.config.colors.main)
				.setImage(emojis[index]?.url ?? "")
				.setFooter({ text: `Emoji ${index + 1} of ${emojis.length}` });

		const getButtons = (disabled = false) =>
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId("prev")
					.setLabel("⬅️")
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(index === 0 || disabled),
				new ButtonBuilder().setCustomId("add").setLabel("✨ Add Emoji").setStyle(ButtonStyle.Success).setDisabled(disabled),
				new ButtonBuilder().setCustomId("add_sticker").setLabel("✨ Add Sticker").setStyle(ButtonStyle.Success).setDisabled(disabled),
				new ButtonBuilder()
					.setCustomId("next")
					.setLabel("➡️")
					.setStyle(ButtonStyle.Secondary)
					.setDisabled(index === emojis.length - 1 || disabled),
			);

		const message = await ctx.editOrReply({
			embeds: [getEmbed()],
			components: [getButtons()],
		});

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 60000,
		});

		collector.on("collect", async (i) => {
			if (i.user.id !== ctx.author?.id) return i.reply({ content: "This interaction isn't for you.", ephemeral: true });

			await i.deferUpdate();

			if (i.customId === "prev") index = Math.max(0, index - 1);
			if (i.customId === "next") index = Math.min(emojis.length - 1, index + 1);

			if (i.customId === "add") {
				const current = emojis[index];
				const emojiName = current?.name || "stolen";
				try {
					await ctx.guild.emojis.create({ name: emojiName, attachment: current?.url || "" });
					await message.edit({
						content: `Emoji \`${emojiName}\` added successfully!`,
						embeds: [getEmbed(true)],
						components: [getButtons()],
					});
				} catch (_err) {
					await message.edit({
						content: null,
						embeds: [new EmbedBuilder().setColor("Red").setDescription(`<:Cross:1375519752746958858> Failed to add emoji \`${emojiName}\``)],
						components: [getButtons()],
					});
				}
				return;
			}
			if (i.customId === "add_sticker") {
				const current = emojis[index];
				const emojiName = current?.name || "stolen";
				const file = new AttachmentBuilder(current?.url || "").attachment;
				try {
					await ctx.guild.stickers.create({ name: emojiName, tags: emojiName, file: file });
					await message.edit({
						content: `Sticker \`${emojiName}\` added successfully!`,
						embeds: [getEmbed(true)],
						components: [getButtons()],
					});
				} catch (_err) {
					await message.edit({
						content: null,
						embeds: [new EmbedBuilder().setColor("Red").setDescription(`<:Cross:1375519752746958858> Failed to add sticker \`${emojiName}\``)],
						components: [getButtons()],
					});
				}
				return;
			}

			await message.edit({
				embeds: [getEmbed()],
				components: [getButtons()],
			});
		});

		collector.on("end", () => {
			message.edit({ components: [getButtons(true)] }).catch(() => null);
		});
	}
}
