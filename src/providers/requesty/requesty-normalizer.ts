import type { RequestyThresholds, UsageSnapshot, UsageWindow } from "../types.ts";
import { DEFAULT_REQUESTY_THRESHOLDS } from "../types.ts";
import type { RequestyOrgResponse, RequestyUsageResponse } from "./requesty-types.ts";

/** Requesty has no percentage windows — both are always unknown. */
const EMPTY_WINDOW: UsageWindow = { usedPercent: null, resetAt: null };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Severity ordering for the per-metric money statuses (ok < warning < critical). */
const SEVERITY: Record<"ok" | "warning" | "critical", number> = {
	ok: 0,
	warning: 1,
	critical: 2,
};

/**
 * Map a single money metric to a usage status. Balance warns *below* thresholds (money running
 * out), spend warns *above* them (money being used up).
 *
 * Balance: `critical` when ≤ `balanceCriticalUsd`, `warning` when ≤ `balanceWarningUsd`.
 * Spend: `critical` when ≥ `spendCriticalUsd`, `warning` when ≥ `spendWarningUsd`.
 */
export function requestyMetricStatus(
	value: number,
	kind: "balance" | "spend",
	thresholds: RequestyThresholds = DEFAULT_REQUESTY_THRESHOLDS,
): "ok" | "warning" | "critical" {
	if (kind === "balance") {
		if (value <= thresholds.balanceCriticalUsd) {
			return "critical";
		}
		if (value <= thresholds.balanceWarningUsd) {
			return "warning";
		}
		return "ok";
	}
	if (value >= thresholds.spendCriticalUsd) {
		return "critical";
	}
	if (value >= thresholds.spendWarningUsd) {
		return "warning";
	}
	return "ok";
}

/**
 * Normalize raw Requesty org + usage responses into a provider-agnostic {@link UsageSnapshot}.
 *
 * `balanceUsd` comes from the org call; `spend24hUsd` sums the spend of entries whose period
 * start falls within the last 24 h before `now`; `spend7dUsd` sums ALL entries (the request
 * covers exactly 7 days). Unparseable period keys count toward the 7 d sum but not the 24 h
 * sum; a missing `usage` map yields `null` for both spends. Money is rounded to 2 decimals.
 *
 * The overall status is the worst of the per-metric statuses (ok < warning < critical);
 * metrics without a value contribute no status. Never throws.
 */
export function normalizeRequestyUsage(
	org: RequestyOrgResponse,
	usage: RequestyUsageResponse,
	thresholds: RequestyThresholds,
	now: Date,
): UsageSnapshot {
	const nowMs = now.getTime();
	const balanceUsd = finiteOrNull(org.balance);
	const spend24hUsd = sumSpends(usage, { minPeriodStartMs: nowMs - DAY_MS, maxPeriodStartMs: nowMs });
	const spend7dUsd = sumSpends(usage, null);

	const statuses: Array<"ok" | "warning" | "critical"> = [];
	if (balanceUsd !== null) {
		statuses.push(requestyMetricStatus(balanceUsd, "balance", thresholds));
	}
	if (spend24hUsd !== null) {
		statuses.push(requestyMetricStatus(spend24hUsd, "spend", thresholds));
	}
	if (spend7dUsd !== null) {
		statuses.push(requestyMetricStatus(spend7dUsd, "spend", thresholds));
	}
	const status =
		statuses.length === 0
			? "ok"
			: statuses.reduce((worst, s) => (SEVERITY[s] > SEVERITY[worst] ? s : worst));

	return {
		provider: "requesty",
		session: EMPTY_WINDOW,
		weekly: EMPTY_WINDOW,
		status,
		updatedAt: now.toISOString(),
		stale: false,
		requesty: {
			balanceUsd,
			spend24hUsd,
			spend7dUsd,
			thresholds,
		},
	};
}

/**
 * Sum the `spend` of all usage entries, optionally restricted to entries whose period start
 * falls inside a window. `null` when the `usage` map is missing (nothing to sum). Unparseable
 * period keys are skipped by the window filter but still count toward an unrestricted sum.
 * Returns a 2-decimal-rounded number when the map exists.
 */
function sumSpends(
	usage: RequestyUsageResponse,
	window: { minPeriodStartMs: number; maxPeriodStartMs: number } | null,
): number | null {
	const entries = usage?.usage;
	if (!entries) {
		return null;
	}
	let total = 0;
	for (const period of Object.keys(entries)) {
		const spend = entries[period]?.spend;
		if (typeof spend !== "number" || !Number.isFinite(spend)) {
			continue;
		}
		if (window !== null) {
			const startMs = new Date(period).getTime();
			if (Number.isNaN(startMs) || startMs < window.minPeriodStartMs || startMs > window.maxPeriodStartMs) {
				continue;
			}
		}
		total += spend;
	}
	return roundMoney(total);
}

/** `null` when the value is missing or not a finite number. */
function finiteOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? roundMoney(value) : null;
}

/** Round money to 2 decimals. */
function roundMoney(value: number): number {
	return Math.round(value * 100) / 100;
}
