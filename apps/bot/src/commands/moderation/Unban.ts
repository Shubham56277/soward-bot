import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, User, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Unban extends Command {
    constructor() {
        super({
            name: "unban",
            description: {
                content: "Remove a user's ban from the server",
                examples: [
                    "unban 123456789012345678",
                    "unban @username"
                ],
                usage: "unban <user> [reason]",
            },
            category: "moderation",
            aliases: ["pardon", "removeban"],
            cooldown: 5,
            args: true,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ["BanMembers", "ViewChannel", "EmbedLinks", "SendMessages"],
                user: ["BanMembers"],
            },
            slashCommand: true,
            options: [
                {
                    name: "user",
                    description: "The user to unban (ID or username#discriminator)",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: "reason",
                    description: "Reason for the unban",
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
        const userInput = ctx.options.getString("user", true);
        let reason = ctx.options.getString("reason") || "No reason provided";

        if (!ctx.isInteraction) {
            reason = ctx.args.slice(1).join(" ") || "No reason provided";
        }

        try {
            let user: User | undefined;
            const bans = await ctx.guild.bans.fetch();

            const idMatch = userInput.match(/^(?:<@!?)?(\d+)>?$/);
            if (idMatch) {
                const userId = idMatch[1];
                user = bans.find(ban => ban.user.id === userId)?.user;
            } else {
                const [username, discriminator] = userInput.split("#");
                user = bans.find(ban =>
                    ban.user.username === username &&
                    (!discriminator || ban.user.discriminator === discriminator)
                )?.user;
            }

            if (!user) {
                return await ctx.sendMessage(this.msg("This user is not currently banned or could not be found."));
            }

            await ctx.guild.bans.remove(user, reason);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**<:Tick:1375519268292264012> Ban Removed**`))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `**User:** ${user.tag}\n` +
                    `**Moderator:** ${ctx.author?.toString() ?? "Unknown"}\n` +
                    `**Reason:** ${reason}`
                ))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ID: ${user.id}`));

            return await ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });

        } catch (error) {
            console.error("Unban Error:", error);
            return await ctx.sendMessage(this.msg("An error occurred while trying to unban this user."));
        }
    }
}
