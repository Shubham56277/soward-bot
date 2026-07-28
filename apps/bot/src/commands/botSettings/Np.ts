import NoPrefix from "./NoPrefix";

/**
 * `np` is a short alias for the `noprefix` command. Aliases are disabled
 * globally in the framework, so this is registered as its own canonical
 * command that reuses the full NoPrefix implementation.
 */
export default class Np extends NoPrefix {
	public constructor() {
		super();
		this.name = "np";
	}
}
