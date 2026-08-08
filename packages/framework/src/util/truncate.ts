export function truncate(text: string, length: number, splitChar = " "): string {
	if (!Number.isSafeInteger(length)) throw new TypeError("length must be a safe integer");
	if (length <= 0) return "";
	if (text.length <= length) return text;
	if (length <= 3) return text.slice(0, length);
	if (!splitChar) return `${text.slice(0, length - 3)}...`;

	const available = length - 3;
	const boundary = text.lastIndexOf(splitChar, available);
	if (boundary <= 0) return `${text.slice(0, available)}...`;
	return `${text.slice(0, boundary).trimEnd()}...`;
}
