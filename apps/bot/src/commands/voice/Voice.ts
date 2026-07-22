import { ApplicationCommandOptionType, ChannelType } from "discord.js";
import Command from "../../abstract/Command";
import Context from "../../lib/Context";
import VcAllow from "./vcallow";
import VcHide from "./vchide";
import VcKick from "./vckick";
import VcKickAll from "./vckickall";
import VcLimit from "./vclimit";
import VcLock from "./vclock";
import VcMove from "./vcmove";
import VcMoveAll from "./vcmoveall";
import VcPull from "./vcpull";
import VcReject from "./vcreject";
import VcRename from "./vcrename";
import VcUnhide from "./vcunhide";
import VcUnlock from "./vcunlock";
import VoiceMaster from "../voicemaster/Voicemaster";

const handlers = {
	allow: new VcAllow(),
	hide: new VcHide(),
	disconnect: new VcKick(),
	"disconnect-all": new VcKickAll(),
	limit: new VcLimit(),
	lock: new VcLock(),
	move: new VcMove(),
	"move-all": new VcMoveAll(),
	pull: new VcPull(),
	reject: new VcReject(),
	rename: new VcRename(),
	public: new VcUnhide(),
	unlock: new VcUnlock(),
	temporary: new VoiceMaster(),
} as const;

export default class Voice extends Command {
	public constructor() {
		super({
			name: "voice",
			description: { content: "Manage voice channels and temporary rooms", examples: ["voice lock", "voice move user:@member"], usage: "voice <action>" },
			category: "voice",
			cooldown: 5,
			slashCommand: true,
			permissions: { dev: false, client: ["SendMessages", "ReadMessageHistory", "ViewChannel", "EmbedLinks", "ManageChannels", "MoveMembers"], user: [] },
			options: [
				{ name: "allow", description: "Allow a user into your room", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "user", description: "User", type: ApplicationCommandOptionType.User, required: true }] },
				{ name: "hide", description: "Hide your room", type: ApplicationCommandOptionType.Subcommand },
				{ name: "disconnect", description: "Disconnect a user", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "user", description: "User", type: ApplicationCommandOptionType.User, required: true }] },
				{ name: "disconnect-all", description: "Disconnect everyone from your room", type: ApplicationCommandOptionType.Subcommand },
				{ name: "limit", description: "Set room user limit", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "limit", description: "Limit 0-99", type: ApplicationCommandOptionType.Integer, required: true, min_value: 0, max_value: 99 }] },
				{ name: "lock", description: "Lock your room", type: ApplicationCommandOptionType.Subcommand },
				{ name: "move", description: "Move a user", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "user", description: "User", type: ApplicationCommandOptionType.User, required: true }, { name: "channel", description: "Target channel", type: ApplicationCommandOptionType.Channel, channel_types: [ChannelType.GuildVoice], required: false }] },
				{ name: "move-all", description: "Move everyone to a voice channel", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "channel", description: "Target channel", type: ApplicationCommandOptionType.Channel, channel_types: [ChannelType.GuildVoice], required: true }] },
				{ name: "pull", description: "Pull a user to your room", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "user", description: "User", type: ApplicationCommandOptionType.User, required: true }] },
				{ name: "reject", description: "Reject a user from your room", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "user", description: "User", type: ApplicationCommandOptionType.User, required: true }] },
				{ name: "rename", description: "Rename your room", type: ApplicationCommandOptionType.Subcommand, options: [{ name: "name", description: "New name", type: ApplicationCommandOptionType.String, required: true, max_length: 100 }] },
				{ name: "public", description: "Make your room visible", type: ApplicationCommandOptionType.Subcommand },
				{ name: "unlock", description: "Unlock your room", type: ApplicationCommandOptionType.Subcommand },
				{ name: "temporary", description: "Setup or reset temporary voice", type: ApplicationCommandOptionType.SubcommandGroup, options: [
					{ name: "setup", description: "Setup temporary voice", type: ApplicationCommandOptionType.Subcommand },
					{ name: "reset", description: "Reset temporary voice", type: ApplicationCommandOptionType.Subcommand },
				] },
			],
		});
	}

	public async run(ctx: Context): Promise<any> {
		const group = ctx.options.getSubcommandGroup(false);
		const action = (group === "temporary" ? "temporary" : ctx.options.getSubCommand(true, 0)) as keyof typeof handlers;
		return handlers[action]?.run(ctx) ?? ctx.sendMessage("That voice action is not available.");
	}
}
