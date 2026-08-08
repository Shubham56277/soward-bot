import type {
	APIChannel,
	APIInteractionDataResolvedChannel,
	APIInteractionDataResolvedGuildMember,
	Attachment,
	CacheType,
	CacheTypeReducer,
	Channel,
	Collection,
	GuildBasedChannel,
	GuildMember,
	Message,
	Role,
	User,
} from "discord.js";
import type {
	APIAttachment,
	APIGuildMember,
	APIMessage,
	APIPartialChannel,
	APIRole,
	APIUser,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ComponentType,
	ModalSubmitActionRowComponent,
	Permissions,
	Snowflake,
} from "discord-api-types/v10";

export type CommandPayload = Readonly<{
	name: string;
	type?: ApplicationCommandType | undefined;
}>;

export type ComponentPayload = Readonly<{
	componentType: ComponentType;
	components?: ModalSubmitActionRowComponent[] | undefined;
	customId: string;
	values?: string[] | undefined;
}>;

export enum Runtime {
	Raw = 0,
	Discordjs = 1,
}

type Option = Readonly<
	{
		name: string;
		required?: boolean | undefined;
	} & (
		| {
				choices?: readonly Readonly<{ name: string; value: number }>[] | undefined;
				type: ApplicationCommandOptionType.Integer | ApplicationCommandOptionType.Number;
		  }
		| {
				choices?: readonly Readonly<{ name: string; value: string }>[] | undefined;
				type: ApplicationCommandOptionType.String;
		  }
		| {
				options?: readonly Option[] | undefined;
				type: ApplicationCommandOptionType.Subcommand | ApplicationCommandOptionType.SubcommandGroup;
		  }
		| {
				type:
					| ApplicationCommandOptionType.Attachment
					| ApplicationCommandOptionType.Boolean
					| ApplicationCommandOptionType.Channel
					| ApplicationCommandOptionType.Mentionable
					| ApplicationCommandOptionType.Role
					| ApplicationCommandOptionType.User;
		  }
	)
>;

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

type TypeIdToType<T, O, C, P, R extends CacheType = "cached"> = T extends ApplicationCommandOptionType.Subcommand
	? ArgumentsOfRaw<O, P, R>
	: T extends ApplicationCommandOptionType.SubcommandGroup
		? ArgumentsOfRaw<O, P, R>
		: T extends ApplicationCommandOptionType.String
			? C extends readonly { value: string }[]
				? C[number]["value"]
				: string
			: T extends ApplicationCommandOptionType.Integer | ApplicationCommandOptionType.Number
				? C extends readonly { value: number }[]
					? C[number]["value"]
					: number
				: T extends ApplicationCommandOptionType.Boolean
					? boolean
					: T extends ApplicationCommandOptionType.User
						? P extends Runtime.Discordjs
							? {
									member?: CacheTypeReducer<R, GuildMember, APIInteractionDataResolvedGuildMember> | undefined;
									user: User;
								}
							: { member?: (APIGuildMember & { permissions: Permissions }) | undefined; user: APIUser }
						: T extends ApplicationCommandOptionType.Channel
							? P extends Runtime.Discordjs
								? CacheTypeReducer<R, GuildBasedChannel, APIInteractionDataResolvedChannel>
								: APIPartialChannel & { permissions: Permissions }
							: T extends ApplicationCommandOptionType.Role
								? P extends Runtime.Discordjs
									? CacheTypeReducer<R, Role, APIRole>
									: APIRole
								: T extends ApplicationCommandOptionType.Mentionable
									? P extends Runtime.Discordjs
										?
												| CacheTypeReducer<R, Role, APIRole>
												| {
														member?: CacheTypeReducer<R, GuildMember, APIInteractionDataResolvedGuildMember>;
														user: User;
												  }
												| undefined
										: APIRole | { member?: (APIGuildMember & { permissions: Permissions }) | undefined; user: APIUser } | undefined
									: T extends ApplicationCommandOptionType.Attachment
										? P extends Runtime.Discordjs
											? Attachment
											: APIAttachment
										: never;

type OptionToObject<O, P, Z extends CacheType = "cached"> = O extends {
	choices?: infer C | undefined;
	name: infer K;
	options?: infer O | undefined;
	required?: infer R | undefined;
	type: infer T;
}
	? K extends string
		? R extends true
			? { [k in K]: TypeIdToType<T, O, C, P, Z> }
			: T extends ApplicationCommandOptionType.Subcommand | ApplicationCommandOptionType.SubcommandGroup
				? { [k in K]: TypeIdToType<T, O, C, P, Z> }
				: { [k in K]?: TypeIdToType<T, O, C, P, Z> | undefined }
		: never
	: never;

type ArgumentsOfRaw<O, P, T extends CacheType = "cached"> = O extends readonly unknown[] ? UnionToIntersection<OptionToObject<O[number], P, T>> : never;

export type ArgumentsOf<C extends CommandPayload | ComponentPayload, P extends Runtime = Runtime.Discordjs, T extends CacheType = "cached"> = C extends {
	options: readonly Option[];
}
	? UnionToIntersection<OptionToObject<C["options"][number], P, T>>
	: C extends { type: ApplicationCommandType.Message }
		? { message: P extends Runtime.Discordjs ? Message<true> : APIMessage }
		: C extends { type: ApplicationCommandType.User }
			? P extends Runtime.Discordjs
				? {
						user: {
							member?: CacheTypeReducer<T, GuildMember, APIInteractionDataResolvedGuildMember> | undefined;
							user: User;
						};
					}
				: { user: { member?: APIInteractionDataResolvedGuildMember | undefined; user: APIUser } }
			: C extends { componentType: ComponentType.Button }
				? ComponentArgument<C, string>
				: C extends { componentType: ComponentType.ChannelSelect }
					? ComponentArgument<
							C,
							P extends Runtime.Discordjs
								? Collection<Snowflake, CacheTypeReducer<T, Channel, APIChannel, APIChannel | Channel, APIChannel | Channel>>
								: Map<Snowflake, APIInteractionDataResolvedChannel>
						>
					: C extends { componentType: ComponentType.MentionableSelect }
						? ComponentArgument<
								C,
								P extends Runtime.Discordjs
									? {
											members: Collection<Snowflake, CacheTypeReducer<T, GuildMember, APIGuildMember, APIGuildMember | GuildMember, APIGuildMember | GuildMember>>;
											roles: Collection<Snowflake, CacheTypeReducer<T, Role, APIRole, APIRole | Role, APIRole | Role>>;
											users: Collection<Snowflake, User>;
										}
									: {
											members: Map<Snowflake, APIInteractionDataResolvedGuildMember>;
											roles: Map<Snowflake, APIRole>;
											users: Map<Snowflake, APIUser>;
										}
							>
						: C extends { componentType: ComponentType.RoleSelect }
							? ComponentArgument<C, P extends Runtime.Discordjs ? Collection<Snowflake, CacheTypeReducer<T, Role, APIRole, APIRole | Role, APIRole | Role>> : Map<Snowflake, APIRole>>
							: C extends { componentType: ComponentType.StringSelect }
								? ComponentArgument<C, string[]>
								: C extends { componentType: ComponentType.TextInput }
									? ComponentArgument<C, string>
									: C extends { componentType: ComponentType.UserSelect }
										? ComponentArgument<
												C,
												P extends Runtime.Discordjs
													? {
															members: Collection<Snowflake, CacheTypeReducer<T, GuildMember, APIGuildMember, APIGuildMember | GuildMember, APIGuildMember | GuildMember>>;
															users: Collection<Snowflake, User>;
														}
													: {
															members: Map<Snowflake, APIInteractionDataResolvedGuildMember>;
															users: Map<Snowflake, APIUser>;
														}
											>
										: never;

type ComponentKey<C> = C extends { customId: infer K extends string } ? K : never;
type ComponentArgument<C, V> = { [K in ComponentKey<C>]: V };
