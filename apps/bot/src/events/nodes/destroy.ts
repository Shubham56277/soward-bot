import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";

export default class destroy extends Event {
    constructor(client: BaseClient) {
        super(client, {
            event: "destroy",
        });
    }

    public async execute(): Promise<void> {
        this.client.manager.nodeManager.on("destroy", (node, reason) => {
            this.client.logger.debug(`Node ${node.options.id} destroyed: ${reason}`);
        });
    }
}