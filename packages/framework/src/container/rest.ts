import { REST, type RESTOptions } from "discord.js";
import { env } from "@repo/env";
import { container } from "tsyringe";


export function createREST(options?: Partial<RESTOptions>) {
    const rest = new REST(options).setToken(env.DISCORD_APP_TOKEN);
    container.register(REST, { useValue: rest });
 
    return rest;
}