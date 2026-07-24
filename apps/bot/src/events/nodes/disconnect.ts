import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";

export default class NodeDisconnect extends Event {
    constructor(client: BaseClient) {
        super(client, {
            event: "disconnect",
        });
    }

    public async execute(): Promise<void> {
        this.client.manager.nodeManager.on("disconnect", (node, reason) => {
            const code = reason?.code ?? "unknown";
            const why  = reason?.reason || "no reason given";
            this.client.logger.warn(
                `[lavalink] Node "${node.options.id}" disconnected — code=${code}, reason="${why}". ` +
                `Reconnection will be attempted automatically (retryDelay=${node.options.retryDelay ?? 5000}ms).`
            );
        });

        this.client.manager.nodeManager.on("reconnectinprogress", (node) => {
            this.client.logger.info(
                `[lavalink] Node "${node.options.id}" reconnecting…`
            );
        });

        this.client.manager.nodeManager.on("reconnecting", (node) => {
            this.client.logger.info(
                `[lavalink] Node "${node.options.id}" reconnection attempt in progress.`
            );
        });
    }
}
