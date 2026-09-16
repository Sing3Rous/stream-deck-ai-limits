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
 * Whether a `scope.model` names Fable, in any version.
 *
 * Matched on a prefix rather than equality, and against the id as well as the display name: the
 * endpoint is unofficial, and a future response saying `"Fable 5.1"` or `claude-fable-6` must keep
 * working without a release. A prefix is safe here because the id is vendor-prefixed
 * (`claude-fable-…`) and no other Claude model name begins with "fable".
 */
function isFableModel(model: { id?: string | null; display_name?: string | null } | null | undefined): boolean {
	const name = typeof model?.display_name === "string" ? model.display_name.trim().toLowerCase() : "";
	if (name === FABLE_MODEL_NAME || name.startsWith(`${FABLE_MODEL_NAME} `)) {
		return true;
	}
	const id = typeof model?.id === "string" ? model.id.trim().toLowerCase() : "";
	return id === FABLE_MODEL_NAME || id.includes(`-${FABLE_MODEL_NAME}-`) || id.endsWith(`-${FABLE_MODEL_NAME}`);
}

/**
 * Find the model-scoped weekly limit for Fable in the `limits` array and expose it in the same
 * shape as the top-level windows. Missing array, no Fable entry, or malformed entry → `undefined`.
 */
function findFableWindow(limits: ClaudeLimitEntry[] | null | undefined): ClaudeUsageWindow | undefined {
	if (!Array.isArray(limits)) {
		return undefined;
	}
	const entry = limits.find((l) => l?.kind === "weekly_scoped" && isFableModel(l.scope?.model));
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
