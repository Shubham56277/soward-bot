import BaseClient from "../../base/Client";
import Event from "../../abstract/Event";
import { AuditLogEvent, ChannelType, Events, NonThreadGuildBasedChannel } from "discord.js";
import { AntiNuke } from "@repo/db";

export default class ChannelUpdate extends Event {
    // Ultra-fast cache
    private configCache = new Map<string, AntiNuke>();
    private trustedCache = new Map<string, any>();
    private processingChannels = new Set<string>();

    constructor(client: BaseClient) {
        super(client, {
            event: Events.ChannelUpdate,
        });
    }

    public async execute(): Promise<void> {
        this.client.on(Events.ChannelUpdate, async (oldChannel, channel) => {
            if (channel.isDMBased() || oldChannel.isDMBased() || !channel.guild) return;
            const { guild } = channel;
            const guildId = guild.id;

            // Skip if we're already processing this channel
            if (this.processingChannels.has(channel.id)) return;

            try {
                this.processingChannels.add(channel.id);

                // Ultra-fast config check with cache
                let config = this.configCache.get(guildId);
                if (!config) {
                    config = await this.client.services.antinukes.getConfig(guildId);
                    this.configCache.set(guildId, config);
                    setTimeout(() => this.configCache.delete(guildId), 30000);
                }

                const actionConfig = config?.channel?.find(c => c.type === "update");
                if (!actionConfig?.enabled) return;

                // Fast audit log fetch
                const logs = await guild.fetchAuditLogs({
                    limit: 2,
                    type: AuditLogEvent.ChannelUpdate
                }).catch(() => null);

                if (!logs) return;
                const log = logs.entries.first();
                if (!log || !log.executor) return;

                const executorId = log.executor.id;
                const now = Date.now();

                // Fast early returns
                if (executorId === guild.ownerId ||
                    executorId === this.client.user?.id ||
                    executorId === config.admin ||
                    (now - log.createdTimestamp) > 120000) return;

                // Ultra-fast trusted user check with cache
                let trustedSet = this.trustedCache.get(guildId);
                if (!trustedSet) {
                    trustedSet = new Set(config.trustedUsers?.map(u => u.id) || []);
                    this.trustedCache.set(guildId, trustedSet);
                    setTimeout(() => this.trustedCache.delete(guildId), 30000);
                }

                if (trustedSet.has(executorId)) return;

                // Fast member check using cache first
                let member = guild.members.cache.get(executorId) as any;
                if (!member) {
                    member = await guild.members.fetch(executorId).catch(() => null);
                    if (!member) return;
                }

                if (!this.client.services.antinukes.canModerate(member, guild.members.me!)) return;

                if (actionConfig.limit <= 1) {
                    // Fire punishment immediately without waiting
                    await this.client.services.antinukes.punishUser(
                        guild,
                        executorId,
                        actionConfig.action,
                        "Anti-Channel Protection | Not Whitelisted"
                    );
                    await this.updateChannel(oldChannel, channel);
                    return;
                }

                const tracked = await this.client.services.antinukes.trackAction(
                    guild,
                    executorId,
                    "channelUpdate",
                    actionConfig
                );

                if (tracked) {
                    // Fire punishment immediately without waiting
                    await this.client.services.antinukes.punishUser(
                        guild,
                        executorId,
                        actionConfig.action,
                        "Anti-Channel Protection | Not Whitelisted"
                    );
                    await this.updateChannel(oldChannel, channel);
                }

            } catch (error) {
                this.client.logger?.error?.(error);
            } finally {
                // Remove from processing set after a short delay
                setTimeout(() => this.processingChannels.delete(channel.id), 1000);
            }
        });
    }

    private async updateChannel(oldChannel: NonThreadGuildBasedChannel, channel: NonThreadGuildBasedChannel) {
        
        const type = channel.type;
       
        try {
            if (type === ChannelType.GuildText && oldChannel.type === ChannelType.GuildText) {
                if (oldChannel.name !== channel.name) {
                    await channel.setName(oldChannel.name, "Anti-Channel Protection | Backup Channel");
                }
                if (oldChannel.topic !== channel.topic) {
                    await channel.setTopic(oldChannel.topic, "Anti-Channel Protection | Backup Channel");
                }
                if (oldChannel.position !== channel.position) {
                    await channel.setPosition(oldChannel.position, { reason: "Anti-Channel Protection | Backup Channel" });
                }
                if (oldChannel.parentId !== channel.parentId) {
                    await channel.setParent(oldChannel.parentId, { reason: "Anti-Channel Protection | Backup Channel" });
                }
                if (!oldChannel.permissionOverwrites.cache.equals(channel.permissionOverwrites.cache)) {
                    await channel.permissionOverwrites.set(
                        oldChannel.permissionOverwrites.cache.map(o => ({
                            id: o.id,
                            type: o.type,
                            allow: o.allow.bitfield,
                            deny: o.deny.bitfield
                        })),
                        "Anti-Channel Protection | Backup Channel"
                    );
                }
                if (oldChannel.rateLimitPerUser !== channel.rateLimitPerUser) {
                    await channel.setRateLimitPerUser(oldChannel.rateLimitPerUser, "Anti-Channel Protection | Backup Channel");
                }
                if (oldChannel.nsfw !== channel.nsfw) {
                    await channel.setNSFW(oldChannel.nsfw, "Anti-Channel Protection | Backup Channel");
                }
                if (oldChannel.defaultAutoArchiveDuration !== channel.defaultAutoArchiveDuration) {
                    await channel.setDefaultAutoArchiveDuration(oldChannel.defaultAutoArchiveDuration!, "Anti-Channel Protection | Backup Channel");
                }
            } else if (type === ChannelType.GuildVoice && oldChannel.type === ChannelType.GuildVoice) {
                await channel.edit({
                    name: oldChannel.name,
                    position: oldChannel.position,
                    parent: oldChannel.parentId,
                    permissionOverwrites: oldChannel.permissionOverwrites.cache.map(o => ({
                        id: o.id,
                        type: o.type,
                        allow: o.allow.bitfield,
                        deny: o.deny.bitfield
                    })),
                    bitrate: oldChannel.bitrate,
                    userLimit: oldChannel.userLimit,
                    rtcRegion: oldChannel.rtcRegion,
                    nsfw: oldChannel.nsfw,
                    reason: "Anti-Channel Protection | Backup Channel"
                });
            } else if (type === ChannelType.GuildCategory && oldChannel.type === ChannelType.GuildCategory) {
                await channel.edit({
                    name: oldChannel.name,
                    position: oldChannel.position,
                    permissionOverwrites: oldChannel.permissionOverwrites.cache.map(o => ({
                        id: o.id,
                        type: o.type,
                        allow: o.allow.bitfield,
                        deny: o.deny.bitfield
                    })),
                    reason: "Anti-Channel Protection | Backup Channel"
                });
            }
        } catch (err) {
            console.error("[Channel Revert Failed]:", err);
        }
    }
}