import type { StatusThresholds, UsageProvider } from "../providers/types.ts";
import type { DateFormat } from "../utils/time.ts";

/**
 * Settings persisted per usage key (Claude or Codex), edited via the Property Inspector.
 * All fields optional — the resolver fills in safe defaults.
 *
 * Declared as a `type` (not `interface`) so it satisfies the SDK's `JsonObject` constraint on
 * {@link SingletonAction}.
 */
export type UsageActionSettings = {
	refreshIntervalSec?: number;
	warningThreshold?: number;
	criticalThreshold?: number;
	customCredentialsPath?: string;
	// Single-window action only (ignored by the combined Claude/Codex actions):
	provider?: string;
	window?: string;
	resetDisplay?: string;
	dateFormat?: string;
	providerAccent?: string;
};

/**
 * Default poll interval. 120s keeps steady-state well under the Claude usage endpoint's limit
 * (~5 requests per 5-minute window, after which it returns 429 with Retry-After: 300). Faster
 * polling balances on the edge of that limit and causes periodic stale flicker.
 */
export const DEFAULT_INTERVAL_SEC = 120;
/**
 * Floor on the configurable interval. 60s protects the unofficial endpoints — the Claude usage
 * endpoint blocks (429, Retry-After 300) after only ~5 requests per 5-minute window, so polling
 * faster than 60s reliably trips it and pins the key on stale.
 */
export const MIN_INTERVAL_SEC = 60;
/** Generous ceiling so a typo can't disable refresh for hours. */
export const MAX_INTERVAL_SEC = 3600;

export const DEFAULT_WARNING_THRESHOLD = 70;
export const DEFAULT_CRITICAL_THRESHOLD = 90;

/** Fully-resolved, validated configuration the action/provider actually run with. */
export interface ResolvedUsageSettings {
	intervalSec: number;
	thresholds: StatusThresholds;
	customCredentialsPath: string | undefined;
}

/**
 * Validate and normalize raw settings into a coherent {@link ResolvedUsageSettings}.
 *
 * - interval: clamped to [MIN, MAX], rounded; invalid → default.
 * - thresholds: clamped to 0..100, rounded; invalid → defaults; `critical` forced ≥ `warning`.
 * - custom path: trimmed; empty → undefined (use the default credentials location).
 *
 * Bad input never throws — it falls back to defaults so the plugin keeps working.
 */
export function resolveUsageSettings(settings: UsageActionSettings = {}): ResolvedUsageSettings {
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

function resolveThresholds(settings: UsageActionSettings): StatusThresholds {
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

export function sameResolvedSettings(a: ResolvedUsageSettings, b: ResolvedUsageSettings): boolean {
	return (
		a.intervalSec === b.intervalSec &&
		a.customCredentialsPath === b.customCredentialsPath &&
		a.thresholds.warning === b.thresholds.warning &&
		a.thresholds.critical === b.thresholds.critical
	);
}

// --- Single-window action settings ----------------------------------------

/** Which window the single-window key shows. */
export type WindowKind = "session" | "weekly";
/** What reset info to show under the percentage. */
export type ResetDisplay = "datetime" | "countdown" | "both" | "none";
/** How to tint the key with the provider's brand color. */
export type ProviderAccent = "frame" | "tint" | "none";

export interface ResolvedSingleWindowSettings {
	provider: UsageProvider;
	window: WindowKind;
	resetDisplay: ResetDisplay;
	dateFormat: DateFormat;
	providerAccent: ProviderAccent;
}

const DATE_FORMATS: DateFormat[] = ["day-month", "iso-short", "weekday"];

function pickEnum<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Validate the single-window display settings, falling back to sensible defaults. */
export function resolveSingleWindowSettings(settings: UsageActionSettings = {}): ResolvedSingleWindowSettings {
	return {
		provider: pickEnum<UsageProvider>(settings.provider, ["claude", "codex"], "claude"),
		window: pickEnum<WindowKind>(settings.window, ["session", "weekly"], "session"),
		resetDisplay: pickEnum<ResetDisplay>(settings.resetDisplay, ["datetime", "countdown", "both", "none"], "datetime"),
		dateFormat: pickEnum<DateFormat>(settings.dateFormat, DATE_FORMATS, "day-month"),
		providerAccent: pickEnum<ProviderAccent>(settings.providerAccent, ["frame", "tint", "none"], "frame"),
	};
}

export function sameSingleWindowSettings(a: ResolvedSingleWindowSettings, b: ResolvedSingleWindowSettings): boolean {
	return (
		a.provider === b.provider &&
		a.window === b.window &&
		a.resetDisplay === b.resetDisplay &&
		a.dateFormat === b.dateFormat &&
		a.providerAccent === b.providerAccent
	);
}
