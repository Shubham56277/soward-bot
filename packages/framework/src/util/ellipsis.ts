export function ellipsis(text: string, total: number): string {
	if (!Number.isSafeInteger(total)) throw new TypeError("total must be a safe integer");
	if (total <= 0) return "";
	if (text.length <= total) return text;
	if (total <= 3) return text.slice(0, total);
	return `${text.slice(0, total - 3)}...`;
}
