import { DEFAULT_THRESHOLDS } from "./types.ts";
import type { StatusThresholds, UsageStatus, UsageWindow } from "./types.ts";

/**
 * Map a single percentage to a usage status using the given thresholds.
 *
 * Bands (with default thresholds 70 / 90):
 *   0..warning-1  → ok
 *   warning..critical-1 → warning
 *   critical..99  → critical
 *   100           → limited
 */
export function statusForPercent(percent: number, thresholds: StatusThresholds = DEFAULT_THRESHOLDS): UsageStatus {
	if (percent >= 100) {
		return "limited";
	}
	if (percent >= thresholds.critical) {
		return "critical";
	}
	if (percent >= thresholds.warning) {
		return "warning";
	}
	return "ok";
}

const SEVERITY: Record<UsageStatus, number> = {
	ok: 0,
	warning: 1,
	critical: 2,
	limited: 3,
	// Error-ish statuses are handled before this map is consulted; rank them high so that if
	// they ever flow through `worstStatus` they win.
	stale: 4,
	auth_required: 5,
	rate_limited: 5,
	error: 5,
};

/**
 * Derive the overall status from the two windows: the worse (higher-severity) of the two.
 * Windows with an unknown percentage (`null`) are ignored; if both are unknown the result is
 * `ok` (the caller decides whether an error status applies instead).
 */
export function worstStatus(
	session: UsageWindow,
	weekly: UsageWindow,
	thresholds: StatusThresholds = DEFAULT_THRESHOLDS,
): UsageStatus {
	const statuses: UsageStatus[] = [];
	if (session.usedPercent !== null) {
		statuses.push(statusForPercent(session.usedPercent, thresholds));
	}
	if (weekly.usedPercent !== null) {
		statuses.push(statusForPercent(weekly.usedPercent, thresholds));
	}
	if (statuses.length === 0) {
		return "ok";
	}
	return statuses.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst));
}
