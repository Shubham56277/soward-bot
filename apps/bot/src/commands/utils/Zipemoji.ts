import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import {
    AttachmentBuilder,
    EmbedBuilder,
} from "discord.js";
import archiver from "archiver";
import { PassThrough } from "node:stream";
import { fetch } from 'undici';

export default class ZipEmoji extends Command {
    constructor() {
        super({
            name: "zipemoji",
            description: {
                content: "Downloads all server emojis as a zip file",
                examples: ["zipemoji"],
                usage: "zipemoji",
            },
            category: 'utils',
            aliases: ["emojizip"],
            cooldown: 60,
            args: false,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: [
                    "SendMessages",
                    "ViewChannel",
                    "AttachFiles",
                    "EmbedLinks",
                ],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }

    public async run(ctx: Context): Promise<any> {
        let emojis = ctx.guild.emojis.cache;
        if (!emojis) {
            emojis = await ctx.guild.emojis.fetch();
        }
        if (emojis.size === 0) {
            return ctx.sendMessage("This server has no emojis.");
        }

        // Create initial embed
        const loadingEmbed = new EmbedBuilder()
            .setColor(ctx.client.config.colors.main)
            .setTitle(`📦 Preparing emoji archive for ${ctx.guild.name}`)
            .setThumbnail(ctx.guild.iconURL({ size: 2048 }));

        // Send initial message
        const loadingMsg = await ctx.sendMessage({ embeds: [loadingEmbed] });

        try {
            const archive = archiver("zip", { zlib: { level: 9 } });
            const stream = new PassThrough();

            let successCount = 0;
            let failedCount = 0;

            // Process each emoji
            for (const emoji of emojis.values()) {
                try {
                    const extension = emoji.animated ? "gif" : "png";
                    const url = emoji.imageURL({ size: 2048, extension });

                    if (!url) {
                        failedCount++;
                        continue;
                    }

                    const response = await fetch(url);
                    if (!response.ok) throw new Error("Failed to fetch emoji");

                    const buffer = await response.arrayBuffer();
                    const arrayBuffer = Buffer.from(buffer);
                    archive.append(arrayBuffer, {
                        name: `${emoji.name}.${extension}`,
                    });
                    successCount++;
                } catch (error) {
                    failedCount++;
                    console.error(
                        `Failed to process emoji ${emoji.name}:`,
                        error,
                    );
                }
            }

            if (successCount === 0) {
                const errorEmbed = new EmbedBuilder()
                    .setColor(ctx.client.config.colors.red)
                    .setDescription("<:Cross:1375519752746958858> Failed to process any emojis. Please try again later.");

                return loadingMsg.edit({ embeds: [errorEmbed] });
            }

            archive.finalize();
            archive.pipe(stream);

            // Collect all data from the stream
            const chunks: Buffer[] = [];
            stream.on("data", (chunk) => chunks.push(chunk));
            stream.on("end", async () => {
                const buffer = Buffer.concat(chunks);
                const attachment = new AttachmentBuilder(buffer, {
                    name: `${ctx.guild.name}_emojis.zip`,
                });

                // Create result embed
                const resultEmbed = new EmbedBuilder()
                    .setColor(ctx.client.config.colors.main)
                    .setDescription(`<:Tick:1375519268292264012> Successfully packaged ${successCount} emojis`);

                if (failedCount > 0) {
                    resultEmbed.addFields({
                        name: "Note",
                        value: `⚠️ Failed to package ${failedCount} emojis`,
                    });
                }

                await loadingMsg.edit({
                    embeds: [resultEmbed],
                    files: [attachment],
                });
            });

            stream.on("error", async (error) => {
                console.error("Stream error:", error);
                const errorEmbed = new EmbedBuilder()
                    .setColor(ctx.client.config.colors.red)
                    .setDescription("<:Cross:1375519752746958858> An error occurred while creating the archive. Please try again later.");

                await loadingMsg.edit({ embeds: [errorEmbed] });
            });
        } catch (error) {
            console.error("ZipEmoji error:", error);
            const errorEmbed = new EmbedBuilder()
                .setColor(ctx.client.config.colors.red)
                .setDescription("<:Cross:1375519752746958858> An error occurred while processing emojis. Please try again later.");

            await loadingMsg.edit({ embeds: [errorEmbed] });
        }
    }
}
