import { Room, VoiceCreator, VoiceSettings } from "@repo/db";
import { ChannelType, GuildMember, OverwriteType, PermissionFlagsBits, VoiceState } from "discord.js";
import Redis from "ioredis";

export default class VoiceManager {
	static redis: Redis;
	private permissionsRoomOwner = {
		allow: [
			PermissionFlagsBits.Speak,
			PermissionFlagsBits.Stream,
			PermissionFlagsBits.UseVAD,
			PermissionFlagsBits.Connect,
			PermissionFlagsBits.ViewChannel,
			PermissionFlagsBits.PrioritySpeaker,
			PermissionFlagsBits.CreateInstantInvite,
		],
		deny: [PermissionFlagsBits.MoveMembers, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ManageChannels],
	};
	static rateLimit = {
		joinCount: 3, // Max joins allowed
		timeWindow: 30 * 1000, // 30 seconds in milliseconds
		cooldown: 60 * 1000, // 60 seconds in milliseconds
	};
	static async checkRateLimit(userId: string): Promise<{ limited: boolean; retryAfter: number }> {
		const now = Date.now();
		const key = `voice:ratelimit:${userId}`;

		// Get existing records
		const data = await VoiceManager.redis.get(key);
		let timestamps: number[] = data ? JSON.parse(data) : [];

		// Filter out old entries outside our time window
		timestamps = timestamps.filter((ts) => now - ts <= VoiceManager.rateLimit.timeWindow);

		// Check if user is over limit
		if (timestamps.length >= VoiceManager.rateLimit.joinCount) {
			const retryAfter = VoiceManager.rateLimit.timeWindow - (now - timestamps[0]!);
			return { limited: true, retryAfter };
		}

		// Add new timestamp
		timestamps.push(now);
		await VoiceManager.redis.set(key, JSON.stringify(timestamps), "PX", VoiceManager.rateLimit.timeWindow);

		return { limited: false, retryAfter: 0 };
	}
	static async onRoomJoin(newState: VoiceState) {
		const { member, channel, guild, client } = newState;
		VoiceManager.redis = client.redis;
		if (!member || !guild || !channel) return;

		const creator = await VoiceCreator.getByVoiceChannelId(newState.guild.id!, channel.id);
		if (!creator) return;
		if (member.user.bot) {
			return member.voice.disconnect().catch(() => { });
		}

		const settings = await VoiceSettings.get(newState.guild.id!, member.id);

		if (settings.leave > Date.now()) {
			return member.voice.disconnect().catch(() => { });
		}
		// Check rate limit
		const rateLimit = await VoiceManager.checkRateLimit(member.id);
		if (rateLimit.limited) {
			// Apply cooldown
			settings.leave = Date.now() + Math.max(settings.leave - Date.now(), VoiceManager.rateLimit.cooldown);
			await VoiceSettings.update(newState.guild.id!, member.id, settings);
			return member.voice.disconnect().catch(() => { });
		}
		const name = resolveChannelName(member);

		if (member.voice.channelId !== creator.voiceChannelId) return;

		guild.channels
			.create({
				name: settings.name === "0" ? name : settings.name,
				userLimit: settings.userLimit,
				type: ChannelType.GuildVoice,
				parent: creator.categoryId,
				permissionOverwrites: [
					{
						id: member.id,
						...VoiceManager.prototype.permissionsRoomOwner,
						type: OverwriteType.Member,
					},
				],
				reason: "Creating a private room",
			})
			.then(async (channel) => {
				await channel.permissionOverwrites.edit(newState.guild.roles.everyone, {
					Connect: settings.locked,
					ViewChannel: settings.visible,
				});
				member?.voice
					?.setChannel(channel.id)
					.then(async () => {
						settings.leave = Date.now();
						settings.name = name;

						await VoiceSettings.update(newState.guild.id!, member.id, settings);
						await Room.create({
							voiceChannelId: channel.id,
							ownerId: member.id,
							cooldown: 0,
						});
					})
					.catch(async (e) => {
						await channel.delete("Voice channel error").catch(() => { });
					});
			}).catch(async (e) => {
				await member.voice.disconnect().catch(() => { });
				await channel.delete("Voice channel error").catch(() => { });
				await Room.delete(channel.id).catch(() => { });
			});
	}

	static async onRoomLeave(oldState: VoiceState) {
		const { member, channel, guild } = oldState;
		if (!member || !guild || !channel) return;

		const room = await Room.get(channel.id);
		const creatorDbs = await VoiceCreator.getByGuildId(guild.id!);
		if (!creatorDbs) return;

		if (creatorDbs.voiceChannelId === channel.id || creatorDbs.categoryId === channel.parentId) {
			if (!channel?.parent || channel.id === creatorDbs.voiceChannelId) return;
			if (channel.parent.id !== creatorDbs.categoryId) return;
			const nonBotMembers = channel.members.filter((member) => !member.user.bot);
			if (nonBotMembers.size === 0 && room?.voiceChannelId === channel.id) {
				await Room.delete(channel.id);
				await channel.delete("No one in the room").catch(() => { });
			}

			if (room && room?.ownerId === member.id) {
				const settings = await VoiceSettings.get(member.guild.id!, member.id);
				settings.leave = 1000;
				await VoiceSettings.update(member.guild.id!, member.id, settings);
			}
		}
	}
}

function resolveChannelName(member: GuildMember) {
	const username = member.user.username;
	const channelName = `${username}'s room`;
	return channelName;
}