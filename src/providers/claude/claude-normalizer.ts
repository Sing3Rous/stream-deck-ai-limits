import { worstStatus } from "../status.ts";
import type { StatusThresholds, UsageSnapshot, UsageWindow } from "../types.ts";
import { DEFAULT_THRESHOLDS } from "../types.ts";
import type { ClaudeUsageResponse, ClaudeUsageWindow } from "./claude-types.ts";

/**
 * Convert a raw Claude usage window into the normalized {@link UsageWindow}.
 *
 * `utilization` is a 0..100 percentage (confirmed in Phase 4); it is clamped to that range and
 * rounded to an integer. Missing/invalid values become `null` so the renderer can show a dash
 * instead of crashing.
 */
function normalizeWindow(window: ClaudeUsageWindow | null | undefined): UsageWindow {
	const util = window?.utilization;
	const usedPercent =
		typeof util === "number" && Number.isFinite(util) ? Math.max(0, Math.min(100, Math.round(util))) : null;
	const resetAt = typeof window?.resets_at === "string" ? window.resets_at : null;
	return { usedPercent, resetAt };
}

/**
 * Normalize a raw Claude usage response into a provider-agnostic {@link UsageSnapshot}.
 *
 * Mapping: `five_hour → session`, `seven_day → weekly`. The overall status is the worse of the
 * two windows (via {@link worstStatus}); an incomplete response never throws.
 */
export function normalizeClaudeUsage(
	raw: ClaudeUsageResponse,
	thresholds: StatusThresholds = DEFAULT_THRESHOLDS,
	now: Date = new Date(),
): UsageSnapshot {
	const session = normalizeWindow(raw.five_hour);
	const weekly = normalizeWindow(raw.seven_day);

	return {
		provider: "claude",
		session,
		weekly,
		status: worstStatus(session, weekly, thresholds),
		updatedAt: now.toISOString(),
		stale: false,
	};
}
