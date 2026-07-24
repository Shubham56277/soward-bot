import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, GuildMember, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Deafen extends Command {
    constructor() {
        super({
            name: "deafen",
            description: {
                content: "Server-deafen a member in voice channels",
                examples: ["deafen @user Disrupting voice chat"],
                usage: "deafen <user> [reason]",
            },
            category: "moderation",
            cooldown: 5,
            args: true,
            permissions: {
                dev: false,
                client: ["DeafenMembers", "SendMessages", "ViewChannel"],
                user: ["DeafenMembers"],
            },
            slashCommand: true,
            options: [
                {
                    name: "user",
                    description: "The member to server-deafen",
                    type: ApplicationCommandOptionType.User,
                    required: true,
                },
                {
                    name: "reason",
                    description: "Reason for the deafen",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const target = ctx.options.getMember("user") as GuildMember | null;
        const reason = ctx.options.getString("reason", false, 1) ?? "No reason provided";

        if (!target) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Member not found."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!target.voice.channel) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${target.toString()} is not in a voice channel.`));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (target.voice.serverDeaf) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${target.toString()} is already server-deafened.`));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            await target.voice.setDeaf(true, reason);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Member Deafened**`))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `**Member:** ${target.toString()}\n` +
                    `**Reason:** ${reason}\n` +
                    `**Moderator:** ${ctx.author?.toString() ?? "Unknown"}`
                ));

            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error("Deafen Error:", error);
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Failed to deafen the member."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
}
