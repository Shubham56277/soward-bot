import { ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Guild } from "@repo/db";

export default class GPerms extends Command {
    constructor() {
        super({
            name: "gperms",
            description: {
                content: "Grant or revoke giveaway manager access for a user",
                examples: ["gperms @user", "gperms reset"],
                usage: "gperms <@user | reset>",
            },
            category: "giveaway",
            aliases: ["giveawayperms", "gmanager"],
            cooldown: 5,
            args: false,
            permissions: {
                dev: false,
                client: ["SendMessages", "ViewChannel"],
                user: ["Administrator"],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const guild = await Guild.get(ctx.guild.id);
        const arg = ctx.args[0]?.toLowerCase();

        // Reset
        if (arg === "reset" || arg === "clear" || arg === "remove") {
            await Guild.update(ctx.guild.id, { giveawaysManagerRole: null });
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🎉 Giveaway Permissions"))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Giveaway manager has been **removed**.\n\nOnly users with `Manage Server` or `Administrator` can manage giveaways now."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Set user
        const user = ctx.message?.mentions?.users?.first() || (ctx.args[0] ? await ctx.client.users.fetch(ctx.args[0]).catch(() => null) : null);

        if (user) {
            await Guild.update(ctx.guild.id, { giveawaysManagerRole: user.id });
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🎉 Giveaway Permissions"))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`Giveaway manager set to ${user.toString()}.\n\nThis user can now manage giveaways.`));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Show current config
        const currentManager = guild.giveawaysManagerRole;
        let managerDisplay = "None";
        if (currentManager) {
            const member = ctx.guild.members.cache.get(currentManager);
            managerDisplay = member ? member.toString() : `<@${currentManager}>`;
        }

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🎉 Giveaway Permissions"))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `**Current Giveaway Manager:** ${managerDisplay}\n\n` +
                `**Who can manage giveaways:**\n` +
                `• Developers\n` +
                `• Users with \`Administrator\` permission\n` +
                `• Users with \`Manage Server\` permission\n` +
                (currentManager ? `• ${managerDisplay}\n` : "") +
                `\n**Usage:**\n` +
                `\`?gperms @user\` — Grant giveaway access to a user\n` +
                `\`?gperms reset\` — Remove giveaway manager`
            ));
        return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
