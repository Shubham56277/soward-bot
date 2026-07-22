import { Message } from "discord.js";
import BaseClient from "../../base/Client";
import { AutoMod } from "@repo/db";
import { Redis } from "ioredis"; // Import Redis client

export class AntiLink {
    private readonly client: BaseClient;
    // Cache allowed domains for performance
    private domainCache = new Map<string, boolean>();
    // Track when we last cleared the cache
    private lastCacheClear = Date.now();
    // Cache expiry time (5 minutes)
    private readonly CACHE_TTL = 5 * 60 * 1000;
    // DM cooldown period (30 minutes by default)
    private readonly DM_COOLDOWN = 30 * 60; // 30 minutes in seconds
    // Redis client
    private readonly redis: Redis;
    // Precompiled regex for better performance
    private readonly urlRegex = /(?:https?:\/\/|www\.|(?!www)[a-z0-9-]+\.)[^\s/$.?#].[^\s]*/gi;
    private readonly validDomainRegex = /\.([a-z]{2,}|[a-z]{2}\.[a-z]{2})($|\/)/i;

    constructor(client: BaseClient) {
        this.client = client;
        // Initialize Redis client - assumes client has redis property
        this.redis = client.redis as Redis;
    }

    public config = {
        allowedDomains: [] as string[],
        action: "delete" as "delete" | "warn" | "timeout" | "kick" | "ban",
        timeoutDuration: 60_000, // 1 minute timeout if action is timeout
        dmCooldown: 30 * 60, // 30 minutes cooldown for DMs (in seconds)
    };

    public async checkMessage(message: Message, mod: AutoMod): Promise<{ blocked: boolean; reason: string }> {
        if (message.member?.permissions.has("Administrator") || message.member?.permissions.has("ManageGuild")) {
            return { blocked: false, reason: "" };
        }
        // Skip empty messages or system messages
        if (!message.content || message.system) {
            return { blocked: false, reason: "" };
        }

        // Quick check for any URL-like patterns before doing expensive operations
        if (!this.hasUrlPatterns(message.content)) {
            return { blocked: false, reason: "" };
        }

        // Update config if provided in mod
        if (mod.link?.allowedDomains) this.config.allowedDomains = mod.link.allowedDomains;
        if (mod.link?.action) this.config.action = mod.link.action;
       
        // Clear cache if it's too old
        this.manageDomainCache();

        const content = message.content.toLowerCase();
        const urls = this.detectUrls(content);

        if (urls.length === 0) return { blocked: false, reason: "" };

        // Check against all rules
        const result = this.checkLinks(urls);
        return result;
    }

    private hasUrlPatterns(text: string): boolean {
        // Quick check for URL indicators before using regex
        return text.includes('http') ||
            text.includes('www.') ||
            text.includes('.com') ||
            text.includes('.net') ||
            text.includes('.org') ||
            /\.[a-z]{2,}/i.test(text);
    }

    private detectUrls(text: string): string[] {
        // Use the precompiled regex
        const matches = text.match(this.urlRegex) || [];

        // Use Set for deduplication
        const uniqueUrls = new Set<string>();

        // Filter false positives
        for (const match of matches) {
            // Quick rejection for obvious non-URLs
            if (!match.includes('.')) continue;

            // Check for valid TLD pattern
            if (!this.validDomainRegex.test(match)) continue;

            uniqueUrls.add(match);
        }

        return Array.from(uniqueUrls);
    }

    private checkLinks(urls: string[]): { blocked: boolean; reason: string } {
        // Fast path: if no allowed domains are specified, all links are blocked
        if (this.config.allowedDomains.length === 0) {
            return {
                blocked: true,
                reason: "All links are prohibited in this server"
            };
        }

        for (const url of urls) {
            const domain = this.extractDomain(url);
            if (!domain) continue; // Skip invalid URLs

            // Check domain cache first
            const cachedResult = this.domainCache.get(domain);
            if (cachedResult !== undefined) {
                // If domain is not allowed (false in cache), block it
                if (!cachedResult) {
                    return {
                        blocked: true,
                        reason: `Links from ${domain} are not allowed`
                    };
                }
                continue; // Domain is allowed, continue checking other URLs
            }

            // Check if domain is allowed
            const isAllowed = this.isDomainAllowed(domain);
            this.domainCache.set(domain, isAllowed);

            if (!isAllowed) {
                return {
                    blocked: true,
                    reason: `Links from ${domain} are not allowed`
                };
            }
        }

        return { blocked: false, reason: "" };
    }

    private isDomainAllowed(domain: string): boolean {
        // Check exact match
        if (this.config.allowedDomains.includes(domain)) {
            return true;
        }

        // Check subdomain match
        for (const allowed of this.config.allowedDomains) {
            if (domain.endsWith(`.${allowed}`)) {
                return true;
            }
        }

        return false;
    }

    private manageDomainCache() {
        const now = Date.now();
        if (now - this.lastCacheClear > this.CACHE_TTL) {
            this.domainCache.clear();
            this.lastCacheClear = now;
        }
    }

    private extractDomain(url: string): string {
        try {
            // Use URL constructor for valid URLs
            const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
            return urlObj.hostname.replace(/^www\./, '');
        } catch {
            // Fallback for URLs that can't be parsed
            const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^/\s]+)/i);
            return match ? match[1]?.replace(/^www\./, '') || '' : '';
        }
    }

    public async takeAction(message: Message, reason: string) {
        if (!message.guild) return;

        try {
            // Try to delete message first in all cases
            const deletePromise = message.delete().catch(() => { });

            // Different actions based on configuration
            switch (this.config.action) {
                case "warn":
                    await deletePromise;
                    await this.sendThrottledWarning(message, reason);
                    break;
                case "timeout":
                    await deletePromise;
                    if (message.member) {
                        message.member.timeout(this.config.timeoutDuration, reason)
                            .catch(() => console.error(`Failed to timeout member ${message.author.id}`));
                        // Also send a throttled DM when applying timeout
                        await this.sendThrottledWarning(message, reason);
                    }
                    break;
                case "kick":
                    await deletePromise;
                    if (message.member) {
                        // Send DM before kicking to ensure message is delivered
                        await this.sendThrottledWarning(message, reason);
                        message.member.kick(reason)
                            .catch(() => console.error(`Failed to kick member ${message.author.id}`));
                    }
                    break;
                case "ban":
                    await deletePromise;
                    if (message.member) {
                        // Send DM before banning to ensure message is delivered
                        await this.sendThrottledWarning(message, reason);
                        message.member.ban({ reason })
                            .catch(() => console.error(`Failed to ban member ${message.author.id}`));
                    }
                    break;
                default:
                    await deletePromise;
                    break;
            }
        } catch (error) {
            console.error("Failed to take anti-link action:", error);
        }
    }

    /**
     * Send a warning DM to the user, but throttle using Redis to prevent spam
     * Will only send one message per user per guild within the cooldown period
     */
    private async sendThrottledWarning(message: Message, reason: string): Promise<void> {
        const userId = message.author.id;
        const guildId = message.guild?.id;

        if (!guildId) return;

        // Create a unique key for this user+guild combination
        const redisKey = `antilink:dm:${guildId}:${userId}`;

        try {
            // Check if we've recently sent a DM to this user in this guild
            const exists = await this.redis.exists(redisKey);

            if (exists) {
                // User was already notified recently, skip sending DM
                return;
            }

            // Set the key with expiration (cooldown period)
            await this.redis.set(redisKey, Date.now(), 'EX', this.config.dmCooldown);

            // Send the DM
            await this.sendWarning(message, reason);

        } catch (error) {
            console.error("Error with Redis throttling:", error);
            // On Redis error, fall back to sending the warning anyway
            await this.sendWarning(message, reason);
        }
    }

    private async sendWarning(message: Message, reason: string) {
        message.author.send({
            embeds: [
                {
                    title: "Anti-link warning",
                    description: `You have been warned for sending links in this server\nReason: ${reason}`,
                    color: this.client.config.colors.orange
                }
            ],
            components: [
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            label: `Message From: ${message.guild?.name}`,
                            custom_id: `view_message:${message.id}`,
                            disabled: true,
                            style: 2
                        }
                    ]
                }
            ]
        }).catch((err) => {
            // Failed to DM user - likely has DMs disabled
            console.log(`Failed to send warning DM to ${message.author.tag}: ${err.message}`);
        });
    }
}