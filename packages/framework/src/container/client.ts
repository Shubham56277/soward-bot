import { Client, type ClientOptions } from "discord.js";
import { container } from "tsyringe";

export class FrameWorkClient extends Client {
    constructor(options: ClientOptions) {
        super(options);
        container.register(Client, { useValue: this });
    }
}