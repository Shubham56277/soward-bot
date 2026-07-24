import { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ApplicationCommandOptionType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";

type Choice = "rock" | "paper" | "scissors";

const EMOJI: Record<Choice, string> = {
    rock: "🪨",
    paper: "📄",
    scissors: "✂️",
};

function getResult(player: Choice, bot: Choice): string {
    if (player === bot) return "It's a **tie**!";
    if (
        (player === "rock" && bot === "scissors") ||
        (player === "paper" && bot === "rock") ||
        (player === "scissors" && bot === "paper")
    ) {
        return "You **win**! 🎉";
    }
    return "You **lose**! Better luck next time.";
}

export default class Rps extends Command {
    constructor() {
        super({
            name: "rps",
            description: {
                content: "Play rock paper scissors against the bot",
                examples: ["rps rock", "rps paper", "rps scissors"],
                usage: "rps <rock|paper|scissors>",
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
                    name: "choice",
                    description: "Your choice: rock, paper, or scissors",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: "Rock", value: "rock" },
                        { name: "Paper", value: "paper" },
                        { name: "Scissors", value: "scissors" },
                    ],
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const choiceInput = (ctx.isInteraction
            ? ctx.options.getString("choice", true)
            : ctx.args[0]
        )?.toLowerCase() as Choice | undefined;

        const validChoices: Choice[] = ["rock", "paper", "scissors"];

        if (!choiceInput || !validChoices.includes(choiceInput)) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent("Please choose `rock`, `paper`, or `scissors`."));
            return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const choices: Choice[] = ["rock", "paper", "scissors"];
        const botChoice = choices[Math.floor(Math.random() * choices.length)] as Choice;
        const result = getResult(choiceInput, botChoice);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Rock Paper Scissors**`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `**You:** ${EMOJI[choiceInput]} ${choiceInput}\n` +
                `**Bot:** ${EMOJI[botChoice]} ${botChoice}`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(result));

        return ctx.sendMessage({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}
