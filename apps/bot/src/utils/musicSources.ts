const TRUSTED_HOSTS = new Set([
	"youtube.com",
	"youtu.be",
	"spotify.com",
	"soundcloud.com",
	"cdn.discordapp.com",
	"media.discordapp.net",
]);

function isHostOrSubdomain(hostname: string, trustedHost: string) {
	return hostname === trustedHost || hostname.endsWith(`.${trustedHost}`);
}

function isDiscordAttachmentPath(pathname: string) {
	return pathname.startsWith("/attachments/") || pathname.startsWith("/ephemeral-attachments/");
}

/** Returns true if the given value is a YouTube (youtube.com / youtu.be) URL. */
export function isYoutubeUrl(value: string): boolean {
	try {
		const hostname = new URL(value).hostname.toLowerCase();
		return hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be";
	} catch {
		return false;
	}
}

export function isAllowedDirectMusicUrl(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return true; // Plain text is a normal music search.
	}

	if (url.protocol !== "https:") return false;
	const hostname = url.hostname.toLowerCase();
	if (![...TRUSTED_HOSTS].some(host => isHostOrSubdomain(hostname, host))) return false;
	if ((hostname === "cdn.discordapp.com" || hostname === "media.discordapp.net") && !isDiscordAttachmentPath(url.pathname)) return false;
	return true;
}

export function isDiscordAttachmentUrl(value: string): boolean {
	try {
		const url = new URL(value);
		const hostname = url.hostname.toLowerCase();
		return (
			url.protocol === "https:" &&
			(hostname === "cdn.discordapp.com" || hostname === "media.discordapp.net") &&
			isDiscordAttachmentPath(url.pathname)
		);
	} catch {
		return false;
	}
}
