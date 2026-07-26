import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, TextChannel, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Lockdown extends Command {
    constructor() {
        super({
            name: "lockdown",
            description: {
                content: "Lock all text channels in the server",
                examples: ["lockdown", "lockdown Emergency maintenance"],
                usage: "lockdown <reason>",
            },
            category: "moderation",
            aliases: ["serverlock", "fullockdown"],
            cooldown: 10,
            args: false,
            permissions: {
                dev: false,
                client: ["ManageChannels", "SendMessages"],
                user: ["Administrator"],
            },
            slashCommand: true,
            options: [
                {
                    name: "reason",
                    description: "Reason for lockdown",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                }
            ],
        });
    }

    private msg(text: string): any {
        return {
            components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))],
            flags: MessageFlags.IsComponentsV2,
        };
    }

    public async run(ctx: Context): Promise<any> {
        const reason = ctx.options?.getString("reason") || ctx.args?.join(" ") || "No reason provided";
        const channels = ctx.guild.channels.cache.filter(c => c.isTextBased());

        try {
            const lockPromises = channels.map(async channel => {
                try {
                    await (channel as TextChannel).permissionOverwrites.edit(
                        ctx.guild.roles.everyone,
                        {
                            SendMessages: false,
                            AddReactions: false
                        }
                    );
                    return { success: true, channel };
                } catch {
                    return { success: false, channel };
                }
            });

            const results = await Promise.all(lockPromises);
            const failed = results.filter(r => !r.success).length;

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Server Lockdown**`))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `Locked ${results.length - failed}/${results.length} text channels\n\n` +
                    `**Moderator:** ${ctx.author?.username || "Unknown"}\n` +
                    `**Reason:** ${reason}`
                ))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `-# ${failed > 0 ? `${failed} channels failed to lock` : "All channels locked successfully"}`
                ));

            return await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });

        } catch (error) {
            console.error("Lockdown Error:", error);
            return await ctx.sendMessage(this.msg("Failed to initiate server lockdown"));
        }
    }
}
