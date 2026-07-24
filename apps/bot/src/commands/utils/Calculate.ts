import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

/**
 * Safe math expression evaluator — only allows digits, operators, parentheses, and spaces.
 * Does NOT use eval().
 */
function safeEval(expression: string): number {
    // Whitelist: only allow numbers, decimal points, and basic operators
    if (!/^[\d\s+\-*/().^%]+$/.test(expression)) {
        throw new Error("Invalid characters in expression");
    }

    // Replace ^ with ** for exponentiation
    const sanitized = expression.replace(/\^/g, "**");

    // Use Function constructor in a controlled way — expression is fully sanitized
    // biome-ignore lint/security/noGlobalEval: expression is sanitized above
    const result = Function(`"use strict"; return (${sanitized})`)() as unknown;
    if (typeof result !== "number" || !isFinite(result)) {
        throw new Error("Result is not a valid number");
    }
    return result;
}

export default class Calculate extends Command {
    constructor() {
        super({
            name: "calc",
            description: {
                content: "Calculate a math expression",
                examples: ["calc 2 + 2", "calc (10 * 5) / 2", "calc 2^10"],
                usage: "calc <expression>",
            },
            category: "utils",
            cooldown: 3,
            args: true,
            permissions: {
                dev: false,
                client: ["SendMessages", "ViewChannel"],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: "expression",
                    description: "The math expression to evaluate",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const expression = ctx.isInteraction
            ? ctx.options.getString("expression", true)
            : ctx.args.join(" ");

        if (!expression) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Please provide a math expression."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const result = safeEval(expression);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Calculator**`))
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `**Expression:** \`${expression}\`\n**Result:** \`${result}\``
                ));

            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `Invalid expression. Make sure to use only numbers and operators (\`+\`, \`-\`, \`*\`, \`/\`, \`^\`, \`%\`).`
                ));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
}
