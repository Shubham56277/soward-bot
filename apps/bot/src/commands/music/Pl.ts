import Playlist from "./Playlist";

/**
 * `pl` is a short alias for the `playlist` command. Aliases are disabled
 * globally in the framework, so this is registered as its own canonical
 * command that reuses the full Playlist implementation.
 */
export default class Pl extends Playlist {
	public constructor() {
		super();
		this.name = "pl";
	}
}
