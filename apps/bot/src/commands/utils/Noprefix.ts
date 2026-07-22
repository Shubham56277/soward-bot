import { User } from "@repo/db";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { TimeFormat } from "../../utils/timeFormat";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageActionRowComponentBuilder } from "discord.js";
import { env } from "@repo/env";

export default class NoPrefix extends Command {
    constructor() {
        super({
            name: "noprefix",
            description: {
                content: "Toggle no-prefix status for yourself",
                examples: ["noprefix"],
                usage: "noprefix",
            },
            category: 'utils',
            aliases: ["np"],
            cooldown: 5,
            args: false,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false, // Now a non-dev command
                client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks"],
            },			slashCommand: false,
        });
    }

    public async run(ctx: Context): Promise<any> {

        const authorId = ctx.author?.id;
        if (!authorId) {
            return ctx.sendMessage("This command can only be used by a server member.");
        }

        const currentUser = await User.get(authorId);
		const isDeveloper = env.DEVELOPER_IDS.includes(authorId);
		const hasNoPrefix = await User.getNoPrefix(ctx.author!.id);
		const hasTimedAccess = Boolean(currentUser.noPrefixExpiresAt && currentUser.noPrefixExpiresAt.getTime() > Date.now());
		if (!isDeveloper && !hasNoPrefix && !hasTimedAccess) {
			return ctx.sendMessage("You don't have no-prefix enabled.");
		}
        // Create toggle button
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`noprefix_toggle_${authorId}`)
                .setLabel(hasNoPrefix ? "Disable No-Prefix" : "Enable No-Prefix")
                .setStyle(hasNoPrefix ? ButtonStyle.Danger : ButtonStyle.Success)
        );

        // Check current status
        let statusMessage: string;
        if (hasNoPrefix) {
            const expiresAt = currentUser?.noPrefixExpiresAt;
            if (expiresAt) {
                const remainingTime = TimeFormat.toHumanize(expiresAt.getTime() - Date.now());
                statusMessage = `⏳ Your no-prefix status is **active** and will expire in **${remainingTime}**.`;
            } else {
                statusMessage = "<:Tick:1375519268292264012> Your no-prefix status is **active indefinitely**.";
            }
        } else {
            statusMessage = "<:Cross:1375519752746958858> You currently **don't have** no-prefix enabled.";
        }

        const message = await ctx.sendMessage({
            content: `${statusMessage}\n\nClick the button below to toggle your no-prefix status:`,
            components: [row],
        });

        // Create button collector
        const collector = message.createMessageComponentCollector({
            filter: (i) => i.customId === `noprefix_toggle_${authorId}` && i.user.id === authorId,
            time: 30000, // 30 seconds
        });

        collector.on("collect", async (interaction) => {
            try {
                if (hasNoPrefix) {
                    // Disable no-prefix
                    await User.update(authorId, {
                        noPrefix: false,
                    });
                    await interaction.update({
                        content: "<:Tick:1375519268292264012> Your no-prefix status has been **disabled**.",
                        components: [],
                    });
                } else {
                    // Enable no-prefix indefinitely
                    await User.update(authorId, {
                        noPrefix: true,
                    });
                    await interaction.update({
                        content: "<:Tick:1375519268292264012> Your no-prefix status has been **enabled**.",
                        components: [],
                    });
                }
            } catch (error) {
                console.error(error);
					await interaction.followUp({
						content: "<:Cross:1375519752746958858> An error occurred while updating your no-prefix status.",
						flags: 64,
					});
            }
        });

        collector.on("end", () => {
            message.edit({ components: [] }).catch(() => { });
        });
    }
}
