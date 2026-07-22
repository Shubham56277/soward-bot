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
            this.client.logger.info(`Node ${node.options.id} connected`);
        });
    }
}