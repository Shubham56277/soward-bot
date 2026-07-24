import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

export default class Antiswear extends Command {
    constructor() {
        super({
            name: "antiswear",
            description: {
                content: "Toggle the anti-swear filter for your server",
                examples: ["antiswear"],
                usage: "antiswear",
            },
            category: "automod",
            cooldown: 5,
            args: false,
            permissions: {
                dev: false,
                client: ["ManageGuild", "SendMessages", "ViewChannel"],
                user: ["Administrator"],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const guild = await ctx.client.guilds.fetch(ctx.guild.id);
        const rules = await guild.autoModerationRules.fetch();
        const rule = rules.find(r => r.name === "soward badwords");

        if (!rule) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    "No anti-swear filter found. Use `badword add <word>` to create one first."
                ));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const newState = !rule.enabled;
        await rule.edit({ enabled: newState });

        const statusText = newState ? "**enabled** 🟢" : "**disabled** 🔴";

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Anti-Swear Filter**`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `The anti-swear filter has been ${statusText}.\n` +
                `-# Toggled by ${ctx.author?.toString() ?? "Unknown"}`
            ));

        return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
