import { EmbedBuilder, User, ApplicationCommandOptionType, Colors } from "discord.js";
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

    public async run(ctx: Context): Promise<any> {
        const userInput = ctx.options.getString("user", true);
        let reason = ctx.options.getString("reason") || "No reason provided";

        // Handle text command arguments
        if (!ctx.isInteraction) {
            reason = ctx.args.slice(1).join(" ") || "No reason provided";
        }

        try {
            // Try to fetch the banned user
            let user: User | undefined;
            const bans = await ctx.guild.bans.fetch();

            // Check if input is a mention or ID
            const idMatch = userInput.match(/^(?:<@!?)?(\d+)>?$/);
            if (idMatch) {
                const userId = idMatch[1];
                user = bans.find(ban => ban.user.id === userId)?.user;
            } else {
                // Search by username#discriminator or username
                const [username, discriminator] = userInput.split('#');
                user = bans.find(ban =>
                    ban.user.username === username &&
                    (!discriminator || ban.user.discriminator === discriminator)
                )?.user;
            }

            if (!user) {
                const embed = new EmbedBuilder()
                    .setColor(Colors.Red)
                    .setDescription("This user is not currently banned or could not be found");
                return await ctx.sendMessage({ embeds: [embed] });
            }

            // Execute the unban
            await ctx.guild.bans.remove(user, reason);

            const unbanEmbed = new EmbedBuilder()
                .setColor(Colors.Green)
                .setTitle("<:Tick:1375519268292264012> Ban Removed")
                .setThumbnail(user.displayAvatarURL())
                .setDescription(
                    `**User:** ${user.tag}\n` +
                    `**Moderator:** ${ctx.author?.toString() ?? "Unknown"}\n` +
                    `**Reason:** ${reason}`
                )
                .setFooter({ text: `ID: ${user.id}` })
                .setTimestamp();

            return await ctx.sendMessage({ embeds: [unbanEmbed] });


        } catch (error) {
            console.error("Unban Error:", error);
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setDescription("An error occurred while trying to unban this user");
            return await ctx.sendMessage({ embeds: [embed] });
        }
    }
}