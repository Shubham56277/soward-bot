import {
    _AddUndefinedToPossiblyUndefinedPropertiesOfInterface,
    APIApplicationCommandOption,
    ApplicationCommandType,
    ApplicationIntegrationType,
    InteractionContextType,
    MessageContextMenuCommandInteraction,
    PermissionResolvable,
    UserContextMenuCommandInteraction,
} from 'discord.js';
import Context from '../lib/Context';

interface CommandDescription {
    content: string;
    usage: string;
    examples: string[];
}

interface CommandPlayer {
    voice: boolean;
    active: boolean;
}

interface CommandPermissions {
    dev: boolean;
    client: PermissionResolvable[];
    user: PermissionResolvable[];
}

export interface CommandOptions {
    name: string;
    integration_types?: _AddUndefinedToPossiblyUndefinedPropertiesOfInterface<ApplicationIntegrationType>[];
    contexts?: _AddUndefinedToPossiblyUndefinedPropertiesOfInterface<InteractionContextType>[]
    description?: Partial<CommandDescription>;
    context?: {
        enabled: boolean;
        name: string;
        type: ApplicationCommandType.User | ApplicationCommandType.Message | (ApplicationCommandType.User | ApplicationCommandType.Message)[];
    },
    aliases?: string[];
    cooldown?: number;
    args?: boolean;
    vote?: boolean;
    premium?: boolean;
    player?: Partial<CommandPlayer>;
    permissions?: Partial<CommandPermissions>;
    slashCommand?: boolean;
    options?: APIApplicationCommandOption[];
    category?: string;
    run?: (ctx: Context, args: any) => any;
    contextRun?: (ctx: MessageContextMenuCommandInteraction<"cached"> | UserContextMenuCommandInteraction<"cached">) => any;
}

export default abstract class Command {
    public name: string;
    public integration_types: _AddUndefinedToPossiblyUndefinedPropertiesOfInterface<ApplicationIntegrationType>[];
    public contexts?: _AddUndefinedToPossiblyUndefinedPropertiesOfInterface<InteractionContextType>[]
    public context?: {
        enabled: boolean;
        name: string;
        type: ApplicationCommandType.User | ApplicationCommandType.Message | (ApplicationCommandType.User | ApplicationCommandType.Message)[];
    }
    public description: CommandDescription;
    public aliases: string[];
    public cooldown: number;
    public args: boolean;
    public vote: boolean;
    public premium: boolean;
    public player: CommandPlayer;
    public permissions: CommandPermissions;
    public slashCommand: boolean;
    public options: APIApplicationCommandOption[];
    public category: string;

    constructor(options: CommandOptions) {
        this.name = options.name;
        this.integration_types = options.integration_types ?? [ApplicationIntegrationType.GuildInstall];
        this.context = options.context ?? {
            enabled: false,
            name: '',
            type: ApplicationCommandType.User
        }
        this.description = {
            content: options.description?.content ?? 'No description provided',
            usage: options.description?.usage ?? 'No usage provided',
            examples: options.description?.examples ?? ['No examples provided'],
        };
		// Canonical command names only. Alias metadata is intentionally disabled globally.
		this.aliases = [];
        this.cooldown = options.cooldown ?? 3;
        this.args = options.args ?? false;
        this.vote = options.vote ?? false;
        this.premium = options.premium ?? false;
        this.player = {
            voice: options.player?.voice ?? false,
            active: options.player?.active ?? false,
        };
        this.permissions = {
            dev: options.permissions?.dev ?? false,
            client: options.permissions?.client ?? ['SendMessages', 'ViewChannel', 'EmbedLinks'],
            user: options.permissions?.user ?? [],
        };
        this.slashCommand = options.slashCommand ?? false;
        this.options = options.options ?? [];
        this.category = options.category ?? 'general';
    }

    public abstract run(ctx: Context, args: string[]): Promise<any>;
    public contextRun?(ctx: MessageContextMenuCommandInteraction<"cached"> | UserContextMenuCommandInteraction<"cached">): Promise<any> | undefined;
}
