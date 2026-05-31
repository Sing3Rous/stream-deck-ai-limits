/**
 * Reset-time formatting for the single-window key.
 *
 * All helpers take the reset timestamp as an ISO string (from `UsageWindow.resetAt`) and a
 * reference `now`, so they are deterministic and unit-testable. Output is intentionally short to
 * fit a Stream Deck key.
 */

export type DateFormat = "day-month" | "iso-short" | "weekday";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n: number): string {
	return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Format an absolute reset time in local time.
 *  - `day-month` → `31 May, 14:06`
 *  - `iso-short` → `05/31 14:06`
 *  - `weekday`   → `Sat 14:06`
 * Returns `null` for a missing/invalid timestamp.
 */
export function formatResetTime(isoString: string | null, format: DateFormat = "day-month"): string | null {
	if (!isoString) {
		return null;
	}
	const d = new Date(isoString);
	if (Number.isNaN(d.getTime())) {
		return null;
	}
	const hh = pad2(d.getHours());
	const mm = pad2(d.getMinutes());
	switch (format) {
		case "iso-short":
			return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${hh}:${mm}`;
		case "weekday":
			return `${WEEKDAYS[d.getDay()]} ${hh}:${mm}`;
		case "day-month":
		default:
			return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh}:${mm}`;
	}
}

/**
 * Format the time remaining until reset as a short countdown.
 *  - ≥ 1h → `7h 58m`
 *  - < 1h → `42m`
 *  - past/0 → `now`
 * Returns `null` for a missing/invalid timestamp.
 */
export function formatCountdown(isoString: string | null, now: Date = new Date()): string | null {
	if (!isoString) {
		return null;
	}
	const target = new Date(isoString);
	if (Number.isNaN(target.getTime())) {
		return null;
	}
	const diffMs = target.getTime() - now.getTime();
	if (diffMs <= 0) {
		return "now";
	}
	const totalMinutes = Math.floor(diffMs / 60_000);
	const days = Math.floor(totalMinutes / (60 * 24));
	const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
	const minutes = totalMinutes % 60;

	if (days > 0) {
		return `${days}d ${hours}h`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	return `${minutes}m`;
}
