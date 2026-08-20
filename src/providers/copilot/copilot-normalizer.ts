import { worstStatus } from "../status.ts";
import type { StatusThresholds, UsageSnapshot, UsageWindow } from "../types.ts";
import { DEFAULT_THRESHOLDS } from "../types.ts";
import type { CopilotQuotaSnapshot, CopilotUsageResponse } from "./copilot-types.ts";

/** Copilot has no weekly quota — this window is always unknown. */
const EMPTY_WEEKLY: UsageWindow = { usedPercent: null, resetAt: null };

/**
 * Derive the used percentage from a Copilot quota snapshot.
 *
 * `percent_remaining` is the source of truth: used = 100 - percent_remaining. When it is
 * missing but both `remaining` and `entitlement` are present, fall back to
 * `100 * (1 - remaining / entitlement)`. Unlimited plans and missing numbers → `null` (the
 * renderer shows "No Data" rather than a fake number).
 */
function usedPercentOf(snapshot: CopilotQuotaSnapshot | null | undefined): number | null {
	if (snapshot?.unlimited === true) {
		return null;
	}
	const remaining = snapshot?.percent_remaining;
	if (typeof remaining === "number" && Number.isFinite(remaining)) {
		return clampRound(100 - remaining);
	}
	const left = snapshot?.remaining;
	const total = snapshot?.entitlement;
	if (
		typeof left === "number" &&
		typeof total === "number" &&
		Number.isFinite(left) &&
		Number.isFinite(total) &&
		total > 0
	) {
		return clampRound(100 * (1 - left / total));
	}
	return null;
}

/** Clamp to 0–100 and round to a whole percent. */
function clampRound(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Normalize a raw Copilot usage response into a provider-agnostic {@link UsageSnapshot}.
 *
 * Mapping: `quota_snapshots.premium_interactions → session` (the monthly premium-request
 * quota); the weekly window is always empty (Copilot has no weekly concept). The overall
 * status comes from the session window alone. An incomplete response never throws — missing
 * numbers surface as `usedPercent: null` ("No Data").
 */
export function normalizeCopilotUsage(
	raw: CopilotUsageResponse,
	thresholds: StatusThresholds = DEFAULT_THRESHOLDS,
	now: Date = new Date(),
): UsageSnapshot {
	const session = normalizeSession(raw.quota_snapshots?.premium_interactions, raw.quota_reset_date_utc);
	return {
		provider: "copilot",
		session,
		weekly: EMPTY_WEEKLY,
		status: worstStatus(session, EMPTY_WEEKLY, thresholds),
		updatedAt: now.toISOString(),
		stale: false,
		thresholds,
	};
}

/** Map the premium-interactions snapshot to a session window (usedPercent + resetAt). */
function normalizeSession(
	snapshot: CopilotQuotaSnapshot | null | undefined,
	resetDateUtc: string | null | undefined,
): UsageWindow {
	const resetAt =
		typeof resetDateUtc === "string" && !Number.isNaN(new Date(resetDateUtc).getTime())
			? new Date(resetDateUtc).toISOString()
			: null;
	return { usedPercent: usedPercentOf(snapshot), resetAt };
}
