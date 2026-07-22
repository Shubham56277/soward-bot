import Command from "../../abstract/Command";
import Context from "../../lib/Context";


export default class Ping extends Command {
    constructor() {
        super({
            name: 'ping',
            description: {
                content: 'Shows the ping of the bot.',
                examples: ['ping'],
                usage: 'ping',
            },
            category: 'utils',
            aliases: ['pong'],
            cooldown: 5,
            args: false,
            player: {
                voice: false,
                active: false,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ReadMessageHistory', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }
   public async run(ctx: Context): Promise<any> {
        const msg = await ctx.sendDeferMessage("Pinging...");
        return ctx.editMessage(`Pong! (Latency: ${msg.createdTimestamp - ctx.createdTimestamp}ms. API Latency: ${Math.round(ctx.client.ws.ping)}ms.)`);
    }
}