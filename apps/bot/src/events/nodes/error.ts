import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";

export default class NodeError extends Event {
    constructor(client: BaseClient) {
        super(client, {
            event: "error",
        });
    }

    public async execute(): Promise<void> {
        this.client.manager.nodeManager.on("error", (node, error, payload) => {
            // Detect authentication failures explicitly so they stand out in logs.
            const msg = error?.message ?? String(error);
            const isAuth = msg.toLowerCase().includes("401") ||
                           msg.toLowerCase().includes("unauthorized") ||
                           msg.toLowerCase().includes("authentication") ||
                           msg.toLowerCase().includes("forbidden");

            if (isAuth) {
                this.client.logger.error(
                    `[lavalink] ✗ Node "${node.options.id}" authentication FAILED — ` +
                    `check the authorization password in NODES env. (${msg})`
                );
            } else {
                // Swallow connection errors — the node will retry automatically.
                // Without this listener Node.js throws ERR_UNHANDLED_ERROR and crashes.
                this.client.logger.warn(
                    `[lavalink] Node "${node.options.id}" error: ${msg}`
                );
            }
        });
    }
}
