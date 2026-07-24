import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Massban extends Command {
    constructor() {
        super({
            name: "massban",
            description: {
                content: "Ban multiple users at once",
                examples: ["massban @user1 @user2 @user3 Raiding"],
                usage: "massban <user1> <user2> ... [reason]",
            },
            category: "moderation",
            cooldown: 10,
            args: true,
            permissions: {
                dev: false,
                client: ["BanMembers", "SendMessages", "ViewChannel"],
                user: ["BanMembers"],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const args = ctx.args as string[];
        if (!args || args.length < 1) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Please provide at least one user to ban."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Collect user IDs from mentions or raw IDs; treat non-ID trailing text as reason
        const userIds: string[] = [];
        let reasonStartIndex = args.length;

        for (let i = 0; i < args.length; i++) {
            const arg = args[i] as string;
            const idMatch = arg.match(/^(?:<@!?)?(\d{17,19})>?$/);
            if (idMatch) {
                userIds.push(idMatch[1] as string);
            } else {
                reasonStartIndex = i;
                break;
            }
        }

        const reason = args.slice(reasonStartIndex).join(" ") || "Mass ban";

        if (userIds.length === 0) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("No valid users found. Provide mentions or user IDs."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const results: { id: string; success: boolean; error?: string }[] = [];

        for (const userId of userIds) {
            try {
                await ctx.guild.members.ban(userId, { reason });
                results.push({ id: userId, success: true });
            } catch (err: any) {
                results.push({ id: userId, success: false, error: err.message });
            }
        }

        const succeeded = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);

        const lines: string[] = [
            `**Mass Ban Complete**`,
            `Banned **${succeeded.length}** / **${results.length}** users`,
            `**Reason:** ${reason}`,
        ];

        if (failed.length > 0) {
            lines.push(`\n**Failed (${failed.length}):**`);
            failed.forEach(f => lines.push(`- \`${f.id}\` — ${f.error}`));
        }

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));

        return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
