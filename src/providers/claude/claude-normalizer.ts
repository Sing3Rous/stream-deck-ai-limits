import { worstStatus } from "../status.ts";
import type { StatusThresholds, UsageSnapshot, UsageWindow } from "../types.ts";
import { DEFAULT_THRESHOLDS } from "../types.ts";
import type { ClaudeLimitEntry, ClaudeUsageResponse, ClaudeUsageWindow } from "./claude-types.ts";

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

const FABLE_MODEL_NAME = "fable";

/**
 * Find the model-scoped weekly limit for Fable in the `limits` array and expose it in the same
 * shape as the top-level windows. Missing array, no Fable entry, or malformed entry → `undefined`.
 */
function findFableWindow(limits: ClaudeLimitEntry[] | null | undefined): ClaudeUsageWindow | undefined {
	if (!Array.isArray(limits)) {
		return undefined;
	}
	const entry = limits.find(
		(l) =>
			l?.kind === "weekly_scoped" &&
			typeof l.scope?.model?.display_name === "string" &&
			l.scope.model.display_name.trim().toLowerCase() === FABLE_MODEL_NAME,
	);
	return entry ? { utilization: entry.percent, resets_at: entry.resets_at } : undefined;
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
	const fable = normalizeWindow(findFableWindow(raw.limits));

	return {
		provider: "claude",
		session,
		weekly,
		fable,
		status: worstStatus(session, weekly, thresholds),
		updatedAt: now.toISOString(),
		stale: false,
		thresholds,
	};
}
