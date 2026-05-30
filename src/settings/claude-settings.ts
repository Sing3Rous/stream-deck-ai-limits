import type { StatusThresholds } from "../providers/types.ts";

/**
 * Settings persisted per Claude Usage key (edited via the Property Inspector).
 * All fields optional — the resolver below fills in safe defaults.
 *
 * Declared as a `type` (not `interface`) so it satisfies the SDK's `JsonObject` constraint on
 * {@link SingletonAction}.
 */
export type ClaudeActionSettings = {
	refreshIntervalSec?: number;
	warningThreshold?: number;
	criticalThreshold?: number;
	customCredentialsPath?: string;
};

export const DEFAULT_INTERVAL_SEC = 60;
/** Floor on the configurable interval — protects the unofficial endpoint from over-polling. */
export const MIN_INTERVAL_SEC = 15;
/** Generous ceiling so a typo can't disable refresh for hours. */
export const MAX_INTERVAL_SEC = 3600;

export const DEFAULT_WARNING_THRESHOLD = 70;
export const DEFAULT_CRITICAL_THRESHOLD = 90;

/** Fully-resolved, validated configuration the action/provider actually run with. */
export interface ResolvedClaudeSettings {
	intervalSec: number;
	thresholds: StatusThresholds;
	customCredentialsPath: string | undefined;
}

/**
 * Validate and normalize raw settings into a coherent {@link ResolvedClaudeSettings}.
 *
 * - interval: clamped to [MIN, MAX], rounded; invalid → default.
 * - thresholds: clamped to 0..100, rounded; invalid → defaults; `critical` is forced ≥ `warning`
 *   so the color bands stay coherent.
 * - custom path: trimmed; empty → undefined (use the default credentials location).
 *
 * Bad input never throws — it falls back to defaults so the plugin keeps working.
 */
export function resolveClaudeSettings(settings: ClaudeActionSettings = {}): ResolvedClaudeSettings {
	return {
		intervalSec: resolveIntervalSec(settings.refreshIntervalSec),
		thresholds: resolveThresholds(settings),
		customCredentialsPath: settings.customCredentialsPath?.trim() || undefined,
	};
}

export function resolveIntervalSec(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_INTERVAL_SEC;
	}
	return Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, Math.round(value)));
}

function resolveThresholds(settings: ClaudeActionSettings): StatusThresholds {
	const warning = clampPercent(settings.warningThreshold, DEFAULT_WARNING_THRESHOLD);
	const critical = clampPercent(settings.criticalThreshold, DEFAULT_CRITICAL_THRESHOLD);
	return { warning, critical: Math.max(warning, critical) };
}

function clampPercent(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(0, Math.min(100, Math.round(value)));
}
