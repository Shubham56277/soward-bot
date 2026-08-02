import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import Help from "../utils/Help";

export default class Antiswear extends Command {
    constructor() {
        super({
            name: "antiswear",
            description: {
                content: "Toggle the anti-swear filter for your server",
                examples: ["antiswear toggle", "antiswear on", "antiswear off"],
                usage: "antiswear <toggle|on|off|enable|disable>",
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
        const sub = (ctx.args?.[0] ?? "").toLowerCase();

        if (!sub) return new Help().showCommand(ctx, "antiswear");

        const validActions = ["toggle", "on", "off", "enable", "disable"];
        if (!validActions.includes(sub)) return new Help().showCommand(ctx, "antiswear");

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

        let newState: boolean;
        if (sub === "toggle") {
            newState = !rule.enabled;
        } else if (sub === "on" || sub === "enable") {
            newState = true;
        } else {
            newState = false;
        }

        await rule.edit({ enabled: newState });

        const statusText = newState ? "**enabled**" : "**disabled**";

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
