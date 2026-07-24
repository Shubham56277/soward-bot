import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";

export default class Connect extends Event {
    constructor(client: BaseClient) {
        super(client, {
            event: "connect",
        });
    }

    public async execute(): Promise<void> {
        this.client.manager.nodeManager.on("connect", (node) => {
            const host = node.options.host;
            const port = node.options.port;
            const secure = node.options.secure ? "wss" : "ws";
            this.client.logger.success(
                `[lavalink] ✓ Node "${node.options.id}" connected — ${secure}://${host}:${port} | ` +
                `Session: ${node.sessionId ?? "none"} | Music playback ready.`
            );
        });
    }
}