import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";

export default class NodeCreate extends Event {
    constructor(client: BaseClient) {
        super(client, {
            event: "create",
        });
    }

    public async execute(): Promise<void> {
        this.client.manager.nodeManager.on("create", (node) => {
            this.client.logger.info(`Node ${node.options.id} created`);
        });
    }
}