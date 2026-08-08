import { BlockList, isIP } from "node:net";

const restrictedAddresses = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const) {
	restrictedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["100::", 64],
	["2001:db8::", 32],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const) {
	restrictedAddresses.addSubnet(network, prefix, "ipv6");
}

export function validateImageUrl(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
		const host = url.hostname.toLowerCase();
		if (isPrivateHostname(host)) return null;
		if (!/\.(png|jpe?g|webp|gif)$/i.test(url.pathname)) return null;
		return url.toString();
	} catch {
		return null;
	}
}

export function isPrivateHostname(host: string): boolean {
	const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
	if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local") || normalized.endsWith(".internal")) return true;
	return isIP(normalized) !== 0 && isPrivateAddress(normalized);
}

export function isPrivateAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) return restrictedAddresses.check(address, "ipv4");
	if (family === 6) return restrictedAddresses.check(address, "ipv6");
	return true;
}

export function validatePrefix(value: string | null | undefined): string | null {
	if (!value || value !== value.trim()) return null;
	const prefix = value;
	if (Array.from(prefix).length > 5 || /[\s/@<>`\\]|\p{Cc}|\p{Cf}/u.test(prefix)) return null;
	return prefix;
}

export function validateBio(value: string, maxLength: number): string | null {
	const bio = value.trim();
	if (!bio || bio.length > maxLength || /@everyone|@here|<@&?\d+>/i.test(bio)) return null;
	return bio;
}
