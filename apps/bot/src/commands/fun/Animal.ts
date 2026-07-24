import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ApplicationCommandOptionType, EmbedBuilder } from "discord.js";
import { request } from "undici";

const animals = [
    { name: "Fox", value: "fox" },
    { name: "Cat", value: "cat" },
    { name: "Bird", value: "bird" },
    { name: "Panda", value: "panda" },
    { name: "Red Panda", value: "red_panda" },
    { name: "Raccoon", value: "racoon" },
    { name: "Koala", value: "koala" },
    { name: "Kangaroo", value: "kangaroo" },
    { name: "Whale", value: "whale" },
    { name: "Dog", value: "dog" },
    { name: "Random", value: "random" },
];

export default class Animal extends Command {
    constructor() {
        super({
            name: "animal",
            description: {
                content: "Get random animal facts and images",
                examples: ["animal dog", "animal --random"],
                usage: "animal <type> [--random]",
            },
            category: "fun",
            aliases: ["creature", "wildlife"],
            cooldown: 5,
            args: false,
            permissions: {
                client: ["SendMessages", "EmbedLinks"],
            },
            slashCommand: false,
            options: [{
                name: "type",
                description: "Choose an animal",
                type: ApplicationCommandOptionType.String,
                required: false,
                choices: animals,
            }],
        });
    }

    private async fetchAnimal(animal: string) {
        const factRes = await request(
            `https://api.some-random-api.com/animal/${animal}`,
        );
        const imgRes = await request(
            `https://api.some-random-api.com/img/${
                animal === "red_panda" ? "redpanda" : animal
            }`,
        );

        const factData = await factRes.body.json() as { fact: string };
        const imageData = await imgRes.body.json() as { link: string };
        return {
            fact: factData.fact,
            image: imageData.link,
        };
    }

    public async run(ctx: Context): Promise<any> {
        await ctx.sendDeferMessage("Fetching animal data...");

        try {
            let animal = ctx.args[0]?.toLowerCase();

            // Handle --random flag or no arguments
            if (!animal || animal === "random") {
                const randomAnimal = animals
                    .filter((a) =>
                        a.value !== "random"
                    )[Math.floor(Math.random() * (animals.length - 1))]
                    ?.value ?? "default animal";
                animal = randomAnimal;
            }

            // Validate animal type
            if (!animals.some((a) => a.value === animal)) {
                return ctx.editMessage(
                    `Invalid animal! Choose from: ${
                        animals.map((a) => a.value).join(", ")
                    }`,
                );
            }

            const { fact, image } = await this.fetchAnimal(animal);

            // Fun rating system
            const funRating = Math.floor(Math.random() * 5) + 1;
            const funStars = "⭐".repeat(funRating) + "☆".repeat(5 - funRating);

            const embed = new EmbedBuilder()
                .setColor(0x000000)
                .setTitle(
                    `${animal.charAt(0).toUpperCase() + animal.slice(1)} Fact`,
                )
                .setDescription(fact)
                .setImage(image)
                .addFields(
                    {
                        name: "Fun Rating",
                        value: `${funRating}/5 ${funStars}`,
                        inline: true,
                    },
                    {
                        name: "Scientific Name",
                        value: await this.getScientificName(animal),
                        inline: true,
                    },
                )
            
            return ctx.editMessage({ content: null, embeds: [embed] });
        } catch (error) {
            console.error(error);
            return ctx.editMessage(
                "Failed to fetch animal data. Please try again later!",
            );
        }
    }

    private async getScientificName(animal: string): Promise<string> {
        const names: Record<string, string> = {
            fox: "Vulpes vulpes",
            cat: "Felis catus",
            bird: "Aves",
            panda: "Ailuropoda melanoleuca",
            red_panda: "Ailurus fulgens",
            racoon: "Procyon lotor",
            koala: "Phascolarctos cinereus",
            kangaroo: "Macropodidae",
            whale: "Cetacea",
            dog: "Canis lupus familiaris",
        };
        return names[animal] || "Unknown";
    }
}
