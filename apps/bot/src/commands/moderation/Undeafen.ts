import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, GuildMember, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Undeafen extends Command {
    constructor() {
        super({
            name: "undeafen",
            description: {
                content: "Remove server deafen from a member",
                examples: ["undeafen @user"],
                usage: "undeafen <user>",
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
                    description: "The member to undeafen",
                    type: ApplicationCommandOptionType.User,
                    required: true,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const target = ctx.options.getMember("user") as GuildMember | null;

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

        if (!target.voice.serverDeaf) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${target.toString()} is not server-deafened.`));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            await target.voice.setDeaf(false, `Undeafened by ${ctx.author?.username ?? "a moderator"}`);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Member Undeafened**`))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `**Member:** ${target.toString()}\n` +
                    `**Undeafened by:** ${ctx.author?.toString() ?? "Unknown"}`
                ));

            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error("Undeafen Error:", error);
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Failed to undeafen the member."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
}
