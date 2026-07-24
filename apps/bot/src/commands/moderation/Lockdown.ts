import { EmbedBuilder, TextChannel, ApplicationCommandOptionType } from "discord.js";
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

            const embed = new EmbedBuilder()
                .setColor(failed > 0 ? Colors.Orange : Colors.Green)
                .setTitle("🔐 Server Lockdown")
                .setDescription(
                    `Locked ${results.length - failed}/${results.length} text channels\n\n` +
                    `**Moderator:** ${ctx.author?.toString() || "Unknown"}\n` +
                    `**Reason:** ${reason}`
                )
                .setFooter({
                    text: failed > 0
                        ? `${failed} channels failed to lock`
                        : "All channels locked successfully"
                })
                .setTimestamp();        

            return await ctx.sendMessage({ embeds: [embed] });

        } catch (error) {
            console.error("Lockdown Error:", error);
            const embed = new EmbedBuilder()
                .setColor(0x000000)
                .setDescription("Failed to initiate server lockdown");
            return await ctx.sendMessage({ embeds: [embed] });
        }
    }
}