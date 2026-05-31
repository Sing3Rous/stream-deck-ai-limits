import { worstStatus } from "../status.ts";
import type { StatusThresholds, UsageSnapshot, UsageWindow } from "../types.ts";
import { DEFAULT_THRESHOLDS } from "../types.ts";
import type { CodexRateLimitWindow, CodexUsageResponse } from "./codex-types.ts";

/**
 * Convert a raw Codex rate-limit window into the normalized {@link UsageWindow}.
 *
 * `used_percent` is already a 0..100 percentage (clamped + rounded). `reset_at` is a unix
 * timestamp in **seconds** → converted to an ISO string. Missing values become `null`.
 */
function normalizeWindow(window: CodexRateLimitWindow | null | undefined): UsageWindow {
	const pct = window?.used_percent;
	const usedPercent =
		typeof pct === "number" && Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : null;
	const resetAt =
		typeof window?.reset_at === "number" && Number.isFinite(window.reset_at)
			? new Date(window.reset_at * 1000).toISOString()
			: null;
	return { usedPercent, resetAt };
}

/**
 * Normalize a raw Codex usage response into a provider-agnostic {@link UsageSnapshot}.
 *
 * Mapping: `rate_limit.primary_window → session` (5h), `secondary_window → weekly` (7d). The
 * overall status is the worse of the two windows; an incomplete response never throws.
 */
export function normalizeCodexUsage(
	raw: CodexUsageResponse,
	thresholds: StatusThresholds = DEFAULT_THRESHOLDS,
	now: Date = new Date(),
): UsageSnapshot {
	const rateLimit = raw.rate_limit ?? undefined;
	const session = normalizeWindow(rateLimit?.primary_window);
	const weekly = normalizeWindow(rateLimit?.secondary_window);

	return {
		provider: "codex",
		session,
		weekly,
		status: worstStatus(session, weekly, thresholds),
		updatedAt: now.toISOString(),
		stale: false,
		thresholds,
	};
}
