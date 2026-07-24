import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import { ApplicationCommandOptionType, EmbedBuilder, User } from "discord.js";
import path from "node:path";

const BACKGROUND_IMAGE_URL = "https://images.unsplash.com/photo-1474552226712-ac0f0961a954?q=80&w=2071&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D";

// Lazy-load canvas so a blocked native binary doesn't crash the whole bot
function tryGetCanvas(): typeof import("@napi-rs/canvas") | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require("@napi-rs/canvas") as typeof import("@napi-rs/canvas");
    } catch {
        return null;
    }
}


export default class Ship extends Command {
    constructor() {
        super({
            name: "ship",
            description: {
                content: "Ship two users together",
                examples: ["ship @user1 @user2", "ship @user", "ship"],
                usage: "ship [user1] [user2]",
            },
            category: "fun",
            aliases: ["love", "match"],
            cooldown: 5,
            args: false,
            permissions: {
                client: ["SendMessages", "EmbedLinks"],
            },
            slashCommand: false,
            options: [
                {
                    name: "user",
                    description: "That user to ship with",
                    type: ApplicationCommandOptionType.User,
                    required: false,
                },
            ],
        });
    }

    private generateShipName(user1: string, user2: string): string {
        const name1 = user1.slice(0, Math.floor(user1.length / 2));
        const name2 = user2.slice(Math.floor(user2.length / 2));
        return (name1 + name2).replace(/\s+/g, "");
    }

    private calculateCompatibility(user1: User, user2: User): number {
        // Seed based on user IDs for consistent results
        const seed = Number.parseInt(user1.id.slice(-4), 10) +
            Number.parseInt(user2.id.slice(-4), 10);
        return Math.abs(Math.sin(seed) * 100);
    }
    private async generateShipImage(user1: User, user2: User): Promise<Buffer | null> {
        const cv = tryGetCanvas();
        if (!cv) return null;

        const { createCanvas, loadImage } = cv;
        const canvas = createCanvas(800, 400);
        const ctx = canvas.getContext("2d");
    
        // Load background
        const bgImage = await loadImage(BACKGROUND_IMAGE_URL);
        ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    
        // Vignette overlay for aesthetic depth
        const gradient = ctx.createRadialGradient(400, 200, 100, 400, 200, 400);
        gradient.addColorStop(0, "rgba(0,0,0,0)");
        gradient.addColorStop(1, "rgba(0,0,0,0.5)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    
        // Load avatars
        const [avatar1, avatar2] = await Promise.all([
            loadImage(user1.displayAvatarURL({ extension: "png", size: 256 })),
            loadImage(user2.displayAvatarURL({ extension: "png", size: 256 })),
        ]);
    
        // Helper to draw circular avatar with shadow
        const drawAvatar = (x: number, y: number, image: any) => {
            ctx.save();
            ctx.beginPath();
            ctx.arc(x + 80, y + 80, 80, 0, Math.PI * 2);
            ctx.closePath();
            ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
            ctx.shadowBlur = 10;
            ctx.clip();
            ctx.drawImage(image, x, y, 160, 160);
            ctx.restore();
    
            // White border
            ctx.beginPath();
            ctx.arc(x + 80, y + 80, 80, 0, Math.PI * 2);
            ctx.lineWidth = 6;
            ctx.strokeStyle = "#fff";
            ctx.stroke();
        };
    
        drawAvatar(120, 120, avatar1);
        drawAvatar(520, 120, avatar2);
    
        // Draw heart in the center (use uploaded file)
        const heartImage = await loadImage(path.resolve(__dirname, "..", "..", "..", "images", "heart.png"));
        ctx.drawImage(heartImage, 300, 150, 200, 200);
    
        // Compatibility text
        const compatibility = Math.floor(this.calculateCompatibility(user1, user2));
        ctx.font = "bold 38px Sans-serif";
        ctx.fillStyle = "#fff";
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = 5;
        ctx.textAlign = "center";
        ctx.fillText(`${compatibility}% Match`, 400, 70);
    
        return canvas.toBuffer("image/png");
    }
    
    public async run(ctx: Context): Promise<any> {
        await ctx.sendDeferMessage("Calculating love compatibility...");

        try {
            // Get users (handle random selection if only one/none provided)
            const user1 = ctx.author;
            let user2 = ctx.options.getUser("user2", false, 1);

            // If only one user provided, pick a random server member
            if (!user2 && ctx.guild) {
                const members = await ctx.guild.members.fetch();
                const nonBotMembers = members.filter((m) =>
                    !m.user.bot && m.user.id !== user1?.id
                );
                if (nonBotMembers.size > 0) {
                    user2 = nonBotMembers.random()!.user;
                } else {
                    user2 = ctx.author; // Fallback if no other members
                }
            } else if (!user2) {
                user2 = ctx.author; // Fallback for DMs
            }

            // Calculate compatibility percentage
            const compatibility = Math.floor(
                this.calculateCompatibility(user1 ?? ctx.author, user2 ?? ctx.author),
            );
            const shipName = this.generateShipName(
                user1?.username ?? ctx.author.username,
                user2?.username ?? ctx.author.username,
            );

            // Generate love canvas
            const shipImage = await this.generateShipImage(user1 ?? ctx.author, user2 ?? ctx.author);

            // Compatibility message based on percentage
            let message: string;
            if (compatibility < 30) message = "Not a great match... 💔";
            else if (compatibility < 60) message = "Potential chemistry! 💖";
            else if (compatibility < 85) message = "Great match! 💞";
            else message = "Soulmates! 💘";

            const embed = new EmbedBuilder()
                .setColor(0x000000)
                .setTitle(`💝 ${user1?.username} + ${user2?.username} = ${shipName}`)
                .setDescription(`**Compatibility:** ${compatibility}%\n${message}`);

            if (shipImage) {
                embed.setImage("attachment://ship.jpg");
                return ctx.editMessage({ content: null, embeds: [embed], files: [{ attachment: shipImage, name: "ship.jpg" }] });
            }
            return ctx.editMessage({ content: null, embeds: [embed] });
        } catch (error) {
            console.error(error);
            return ctx.editMessage(
                "Failed to calculate love. Maybe try again? ❤️",
            );
        }
    }
}
