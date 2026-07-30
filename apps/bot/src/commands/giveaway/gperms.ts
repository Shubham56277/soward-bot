import { ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Guild } from "@repo/db";

export default class GPerms extends Command {
    constructor() {
        super({
            name: "gperms",
            description: {
                content: "Set or view the giveaway manager role",
                examples: ["gperms @Events Team", "gperms reset"],
                usage: "gperms <@role | reset>",
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
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Giveaway manager role has been **removed**.\n\nOnly users with `Manage Server` or `Administrator` can manage giveaways now."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Set role
        const role = ctx.message?.mentions?.roles?.first() || (ctx.args[0] ? ctx.guild.roles.cache.get(ctx.args[0]) : null);

        if (role) {
            await Guild.update(ctx.guild.id, { giveawaysManagerRole: role.id });
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🎉 Giveaway Permissions"))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`Giveaway manager role set to ${role.toString()}.\n\nUsers with this role can now manage giveaways.`));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Show current config
        const currentRole = guild.giveawaysManagerRole ? ctx.guild.roles.cache.get(guild.giveawaysManagerRole) : null;
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🎉 Giveaway Permissions"))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `**Current Manager Role:** ${currentRole ? currentRole.toString() : "None"}\n\n` +
                `**Who can manage giveaways:**\n` +
                `• Users with \`Administrator\` permission\n` +
                `• Users with \`Manage Server\` permission\n` +
                (currentRole ? `• Users with the ${currentRole.toString()} role\n` : "") +
                `\n**Usage:**\n` +
                `\`?gperms @role\` — Set giveaway manager role\n` +
                `\`?gperms reset\` — Remove giveaway manager role`
            ));
        return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
