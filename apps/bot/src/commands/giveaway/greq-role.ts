import { MessageFlags, Role } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { Guild } from "@repo/db";

export default class GReqRole extends Command {
    constructor() {
        super({
            name: "greq-role",
            description: {
                content: "Set a role manager for a giveaway",
                examples: ["greq-role set <role>", "greq-role clear"],
                usage: "greq-role <subcommand>",
            },
            category: "giveaway",
            aliases: ["giveawayreq-role"],
            cooldown: 5,
            args: true,
            permissions: {
                dev: false,
                client: ["SendMessages", "ViewChannel", "EmbedLinks"],
                user: ["ManageGuild"],
            },
            slashCommand: false,
            options: [
                {
                    name: "set",
                    description: "Set a role manager for a giveaway",
                    type: 1,
                    options: [
                        {
                            name: "role",
                            description: "Role to set",
                            type: 8,
                            required: true,
                        }
                    ]
                },
                {
                    name: "clear",
                    description: "Clear the role manager for a giveaway",
                    type: 1,
                }
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const guild = await Guild.get(ctx.guild!.id!);

        if (!guild) {
            return ctx.sendMessage("Guild not found");
        }
        const subcommand = ctx.options.getSubCommand();
        if (subcommand === "clear") {
            await Guild.update(ctx.guild!.id, { giveawaysManagerRole: null });
            return ctx.sendMessage({
                content: "Role manager cleared",
                flags: MessageFlags.Ephemeral,
            });
        }
        const role = ctx.options.getRole("role", true, 1) as Role;

       
        await Guild.update(ctx.guild!.id, { giveawaysManagerRole: role.id });
        await ctx.sendMessage({
            content: `Seccessfully set ${role.toString()} as the role manager for giveaways`,
            flags: MessageFlags.Ephemeral,
        });
    }
}
