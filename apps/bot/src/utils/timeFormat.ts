
export enum TimeUnits {
	Millisecond = 1,
	Second = 1000,
	Minute = 60 * TimeUnits.Second, // 60_000
	Hour = 60 * TimeUnits.Minute, // 3_600_000
	Day = 24 * TimeUnits.Hour, // 8_640_000
	Week = 7 * TimeUnits.Day, // 604_800_000
}

const TimeUnitsOrder = {
	ms: TimeUnits.Millisecond,
	s: TimeUnits.Second,
	m: TimeUnits.Minute,
	h: TimeUnits.Hour,
	d: TimeUnits.Day,
	w: TimeUnits.Week,
};

const createMsFormater = (isNormalMode = true, order: typeof TimeUnitsOrder = TimeUnitsOrder) => {
	const unitsLabels = Object.keys(order) as (keyof typeof order)[];
	const unitsValues = Object.values(order) as number[];

	const isDottedMode = isNormalMode === false;

	function baseFormater(time: number = 0, isChild = false): [string, number] {
		time = Math.max(0, Math.floor(Number.isFinite(time) ? time : 0));
		let targetPosition = 0;
		let targetUnitValue = 1;

		for (let i = 0; i < unitsValues.length; i++) {
			const unitValue = unitsValues[i]!;

			if (time < unitValue) break;

			targetPosition = i;
			targetUnitValue = unitValue;
		}

		const unitName = unitsLabels[targetPosition]!;

		const resultTime = Math.floor(time / targetUnitValue).toString();

		let more = time % targetUnitValue;
		let result = resultTime + unitName;

		if (isDottedMode) {
			if (more < 1000) more = 0;
			if (targetPosition === 0) return ["00:00", targetPosition];

			result = isChild
				? resultTime.padStart(2, "0")
				: // do 00:05
					targetPosition <= 1
					? "00:".repeat(targetPosition) + resultTime.padStart(2, "0")
					: resultTime;
		}

		if (more !== 0) {
			const [rest, pos] = baseFormater(more, true);
			if (isNormalMode) result += ` ${rest}`;
			else if (pos !== 0) {
				result += `${":00".repeat(targetPosition - pos - 1)}:${rest}`;
			}
		} else if (isDottedMode && targetPosition >= 1) {
			result += ":00".repeat(targetPosition - 1);
		}

		return [result, targetPosition];
	}

	function formater(time: undefined): void;
	function formater(time: number): string;
	function formater(time: number | undefined): string | undefined;
	function formater(time: number | undefined): string | undefined {
		if (time === undefined) return;
		return baseFormater(time)[0];
	}

	return formater;
};

type TimeRecord = Record<string, number>;

const createAliases = <const R extends TimeRecord, M extends Record<keyof R, string[]>>(base: R, modifiers: M) => {
	const result = { ...base } as TimeRecord;

	for (const [from, aliases] of Object.entries(modifiers)) {
		const value = base[from];

		for (const alias of aliases) {
			result[alias!] = value!;
		}
	}

	return result;
};

const TimeUnitsAliases = createAliases(TimeUnitsOrder, {
	ms: ["milliseconds", "millisecond", "millisec", "millisecs"],
	s: ["seconds", "sec", "second", "secs"],
	m: ["minutes", "min", "minute", "mins"],
	h: ["hours", "hour", "hr", "hrs"],
	d: ["days", "day"],
	w: ["weeks", "week"],
});

const stringToMsRegex = /([0-9][_,.0-9]*)\s*([a-zA-Z]+)/g;
const undescoreAndLastCommaRegex = /_|[,.]+$/g;

const sanitizeNumber = (value: string) => Number(value.replaceAll(undescoreAndLastCommaRegex, "").replaceAll(",", "."));

const formatToMs = (date: string) => {
	let result = 0;

	const matches = date.matchAll(stringToMsRegex);

	for (const [, value, unit] of matches) {
		const unitValue = TimeUnitsAliases[unit!.toLowerCase()];
		if (unitValue === undefined) continue;
		result += sanitizeNumber(value!) * unitValue;
	}

	return result;
};
/**
 * Convert milliseconds to a string and string to milliseconds.
 * @example "2 * 60 * 1000 => 1h"
 * @example "1h => 2 * 60 * 1000"
 */
export function ms(from: string): number;
export function ms(from: number): string;
export function ms(from: string | number): string | number {
	if (typeof from === "string") return formatToMs(from);
	return TimeFormat.toHumanize(from);
}

function toReadableTime(ms: number): string {
	const abs = Math.abs(ms);

	const units: [number, string][] = [
		[TimeUnits.Week, "week"],
		[TimeUnits.Day, "day"],
		[TimeUnits.Hour, "hour"],
		[TimeUnits.Minute, "minute"],
		[TimeUnits.Second, "second"],
	];

	for (const [unitMs, label] of units) {
		const value = Math.floor(abs / unitMs);
		if (value > 0) return `${value} ${label}${value > 1 ? "s" : ""} ago`;
	}

	return "just now";
}
export const TimeFormat = {
	/**
	 * Convert milliseconds to a string format.
	 * @example "1h 4s"
	 */
	toHumanize: createMsFormater(),
	/**
	 * Convert milliseconds to a string dotted format.
	 * This not show ms.
	 * @example "1:00:04"
	 */
	toDotted: createMsFormater(false),
	/**
	 * Convert a string to milliseconds.
	 * @example "1h => 2 * 60 * 1000"
	 */
	toMs: formatToMs,
	ms,

	readable: toReadableTime,
};

//  format number to TB; GB, MB; KB;

export function formatBytes(bytes: number): string {
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	if (bytes === 0) return "0 B";
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
	return `${parseFloat((bytes / 1024 ** i).toFixed(2))} ${sizes[i]}`;
}
