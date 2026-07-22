import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { Events } from "discord.js";

export default class Raw extends Event {
    constructor(client: BaseClient) {
        super(client, {
            event: Events.Raw,
        });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.Raw, (d) => {
            this.client.manager.sendRawData(d);
        });
    }
}