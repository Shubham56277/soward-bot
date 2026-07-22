import { env } from "@repo/env";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ApplicationCommandOptionType, ChannelType, EmbedBuilder } from "discord.js";
import { request } from "undici";

export default class Color extends Command {
    constructor() {
        super({
            name: "color",
            description: {
                content: "Generate and display color images",
                examples: [
                    "color #FF5733",
                    "color --name blurple",
                    "color #00FF00 --shape circle",
                    "color #FFFFFF --alpha 0.5 --format jpeg",
                ],
                usage: "color <color|name> [options]",
            },
            category: "fun",
            aliases: ["colour"],
            cooldown: 5,
            args: true,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: [],
                user: [],
            },
            slashCommand: false,
            options: [
                {
                    name: "value",
                    description: "Color value (hex, rgb, hsl) or preset name",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: "shape",
                    description: "Shape of the color image",
                    type: ApplicationCommandOptionType.String,
                    choices: [
                        { name: "Rectangle", value: "rectangle" },
                        { name: "Circle", value: "circle" },
                    ],
                    required: false,
                },
                {
                    name: "format",
                    description: "Image format",
                    type: ApplicationCommandOptionType.String,
                    choices: [
                        { name: "PNG", value: "png" },
                        { name: "JPEG", value: "jpeg" },
                    ],
                    required: false,
                },
                {
                    name: "alpha",
                    description: "Transparency (0-1)",
                    type: ApplicationCommandOptionType.Number,
                    min_value: 0,
                    max_value: 1,
                    required: false,
                },
                {
                    name: "width",
                    description: "Image width (default: 512)",
                    type: ApplicationCommandOptionType.Integer,
                    min_value: 16,
                    max_value: 2048,
                    required: false,
                },
                {
                    name: "height",
                    description: "Image height (default: 512)",
                    type: ApplicationCommandOptionType.Integer,
                    min_value: 16,
                    max_value: 2048,
                    required: false,
                },
            ],
        });
    }

    public async run(ctx: Context): Promise<any> {
        const colorValue = ctx.options.getString("value", true);
        const shape = ctx.options.getString("shape", false, 1) || "rectangle";
        const format = ctx.options.getString("format", false, 2) || "png";
        const alpha = ctx.options.getNumber("alpha", false, 3); 
        const width = ctx.options.getInteger("width", false, 4);
        const height = ctx.options.getInteger("height", false, 5);

        // Build query parameters
        const queryParams = new URLSearchParams();
        queryParams.append("shape", shape);
        queryParams.append("format", format);
       ;
        if (alpha) queryParams.append("alpha", alpha.toString());
        if (width) queryParams.append("width", width.toString());
        if (height) queryParams.append("height", height.toString());

        // Check if the input is a preset name or color value
        if (/^[a-zA-Z]+$/.test(colorValue)) {
            queryParams.append("name", colorValue.toLowerCase());
        } else {
            queryParams.append("color", colorValue);
        }

        try {
            // Show typing indicator while generating the image
            if (ctx.isInteraction) {
                await ctx.sendDeferMessage("Generating color image...");
            } else {
                if (ctx.channel.type === ChannelType.GuildText) {
                    await ctx.channel.sendTyping();
                }
            }

            const apiUrl =
                `${env.IMAGIFY_API_URL}/api/v1/color?${queryParams.toString()}`;
            const { body, statusCode } = await request(apiUrl);
           
            if (statusCode !== 200) {
                const error = await body.text();
                return ctx.sendMessage(`Please check your input and try again. Error: ${error}`);
            }

            // Get the image buffer
            const imageBuffer = await body.arrayBuffer();
            const buffer = Buffer.from(imageBuffer);

            // Create embed with color information
            const embed = new EmbedBuilder()
                .setTitle(`Color: ${colorValue}`)
                .setColor(this.resolveColor(colorValue))
                .setImage(`attachment://color.${format}`)
                .setFooter({ text: `Shape: ${shape} | Format: ${format}` });

            if (alpha) {
                embed.addFields({
                    name: "Alpha",
                    value: alpha.toString(),
                    inline: true,
                });
            }

            return ctx.editOrReply({
                embeds: [embed],
                files: [{
                    attachment: buffer,
                    name: `color.${format}`,
                }],
            });
        } catch (error) {
            console.error("Color command error:", error);
            return ctx.sendMessage(
                "Failed to generate color image. Please check your input and try again.",
            );
        }
    }

    private resolveColor(input: string): number {
        // Simple hex color resolver for embed colors
        if (input.startsWith("#")) {
            return Number.parseInt(input.slice(1), 16);
        }
        return 0x7289DA; // Default blurple color
    }
}
