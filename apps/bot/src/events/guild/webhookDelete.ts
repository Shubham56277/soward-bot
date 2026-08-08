import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, Events, type ClientEvents, type Guild } from "discord.js";

const CACHE_TTL_MS = 120_000;
const REGISTRATION_KEY = Symbol.for("soward.events.webhookDelete.registration");

type WebhooksUpdateListener = (...args: ClientEvents[Events.WebhooksUpdate]) => void;
type ActionConfig = Parameters<BaseClient["services"]["antinukes"]["trackAction"]>[3];

interface CachedDeletion {
    executorId: string;
    timestamp: number;
}

interface WebhookDeleteRegistration {
    owner: WebhooksUpdate;
    listener: WebhooksUpdateListener;
    cache: Map<string, CachedDeletion>;
    timers: Map<string, NodeJS.Timeout>;
}

type ClientWithRegistration = BaseClient & {
    [key: symbol]: WebhookDeleteRegistration | undefined;
};

export default class WebhooksUpdate extends Event {
    private registration: WebhookDeleteRegistration | null = null;

    constructor(client: BaseClient) {
        super(client, { event: Events.WebhooksUpdate });
    }

    public async execute(): Promise<void> {
        const registeredClient = this.client as ClientWithRegistration;
        const existing = registeredClient[REGISTRATION_KEY];
        if (existing?.owner === this) return;
        if (existing) removeRegistration(this.client, existing);

        const registration: WebhookDeleteRegistration = {
            owner: this,
            listener: (channel) => {
                void this.handleWebhooksUpdate(channel.guild).catch((error) => this.client.logger?.error?.(error));
            },
            cache: new Map(),
            timers: new Map(),
        };
        this.registration = registration;
        registeredClient[REGISTRATION_KEY] = registration;
        this.client.on(Events.WebhooksUpdate, registration.listener);
    }

    /** Optional explicit teardown for loaders that support event disposal. */
    public cleanup(): void {
        const registration = this.registration;
        if (!registration) return;
        removeRegistration(this.client, registration);
        this.registration = null;
    }

    private async handleWebhooksUpdate(guild: Guild): Promise<void> {
        const registration = this.registration;
        if (!registration) return;

        const config = await this.client.services.antinukes.getConfig(guild.id);
        const actionConfig = config?.webhook?.find((candidate) => candidate.type === "delete");
        if (!config?.enabled || !actionConfig?.enabled) return;

        const logs = await guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.WebhookDelete });
        const log = logs.entries.first();
        if (!log?.executor || !log.target) return;

        const now = Date.now();
        if (now - log.createdTimestamp > CACHE_TTL_MS) return;
        const executorId = log.executor.id;
        const webhookId = log.target.id;
        if (registration.cache.has(webhookId)) return;
        cacheDeletion(registration, webhookId, executorId, now);

        if (
            executorId === guild.ownerId
            || executorId === this.client.user?.id
            || executorId === config.admin
        ) return;

        await this.handleWebhookDeletion(guild, executorId, actionConfig);
    }

    private async handleWebhookDeletion(guild: Guild, executorId: string, actionConfig: ActionConfig): Promise<void> {
        if (await this.client.services.antinukes.isBypassed(guild, executorId)) return;

        const member = guild.members.cache.get(executorId) ?? await guild.members.fetch(executorId);
        if (!this.client.services.antinukes.canModerate(member, guild.members.me!)) return;

        const tracked = await this.client.services.antinukes.trackAction(
            guild,
            executorId,
            "webhookDelete",
            actionConfig,
        );
        if (!tracked) return;

        await this.client.services.antinukes.punishUser(
            guild,
            executorId,
            actionConfig.action,
            "Anti-Webhook Protection | Unauthorized Deletion",
        );
    }
}

function cacheDeletion(
    registration: WebhookDeleteRegistration,
    webhookId: string,
    executorId: string,
    timestamp: number,
): void {
    const oldTimer = registration.timers.get(webhookId);
    if (oldTimer) clearTimeout(oldTimer);
    registration.cache.set(webhookId, { executorId, timestamp });
    const timer = setTimeout(() => {
        registration.cache.delete(webhookId);
        registration.timers.delete(webhookId);
    }, CACHE_TTL_MS);
    timer.unref();
    registration.timers.set(webhookId, timer);
}

function removeRegistration(client: BaseClient, registration: WebhookDeleteRegistration): void {
    client.off(Events.WebhooksUpdate, registration.listener);
    for (const timer of registration.timers.values()) clearTimeout(timer);
    registration.timers.clear();
    registration.cache.clear();
    const registeredClient = client as ClientWithRegistration;
    if (registeredClient[REGISTRATION_KEY] === registration) {
        delete registeredClient[REGISTRATION_KEY];
    }
}
