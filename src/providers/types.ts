/**
 * Provider-agnostic usage model.
 *
 * Every provider (Claude, Codex, Requesty) normalizes its raw API response into a
 * {@link UsageSnapshot}. The renderer and cache only ever see this shape — they have no
 * knowledge of provider-specific fields.
 */

export type UsageProvider = "claude" | "codex" | "requesty";

/**
 * Overall key status, derived from the worst of the two usage windows plus error conditions.
 * Drives both the color and the layout chosen by the renderer.
 */
export type UsageStatus =
	| "ok"
	| "warning"
	| "critical"
	| "limited"
	| "stale"
	| "auth_required"
	| "rate_limited"
	| "error";

/**
 * A single usage window (e.g. Claude's 5-hour session or 7-day weekly limit).
 */
export interface UsageWindow {
	/** Percentage used, 0..100, rounded to an integer. `null` when unknown/missing. */
	usedPercent: number | null;
	/** ISO timestamp of when this window resets. `null` when unknown/missing. */
	resetAt: string | null;
}

/**
 * Fully normalized usage result for one provider, ready for rendering and caching.
 */
export interface UsageSnapshot {
	provider: UsageProvider;
	/** Short window — Claude: `five_hour`. */
	session: UsageWindow;
	/** Long window — Claude: `seven_day`. */
	weekly: UsageWindow;
	status: UsageStatus;
	/** ISO timestamp of when this snapshot was produced. */
	updatedAt: string;
	/** True when this is the last-known-good snapshot served after a failed refresh. */
	stale: boolean;
	/**
	 * When `stale` is true, why the refresh failed — lets the renderer show a specific hint
	 * (e.g. a rate-limit clock) instead of a generic "STALE" marker.
	 */
	staleReason?: "rate_limited" | "error";
	/** Human-readable, secret-free error detail for diagnostics. */
	errorMessage?: string;
	/**
	 * Thresholds used to compute statuses, so the renderer can color each bar by its own
	 * percentage. Defaults to {@link DEFAULT_THRESHOLDS} when absent.
	 */
	thresholds?: StatusThresholds;
	/**
	 * Requesty-only money metrics; absent for percentage-based providers.
	 */
	requesty?: {
		/** Current account balance in USD, or `null` when unknown/missing. */
		balanceUsd: number | null;
		/** USD spent in the last 24 hours, or `null` when unknown/missing. */
		spend24hUsd: number | null;
		/** USD spent in the last 7 days, or `null` when unknown/missing. */
		spend7dUsd: number | null;
		/** Thresholds used to derive the statuses. Defaults to {@link DEFAULT_REQUESTY_THRESHOLDS}. */
		thresholds?: RequestyThresholds;
	};
}

/**
 * Default thresholds (used-percent) for mapping a window to a status. Configurable later via
 * Property Inspector (Phase 8).
 */
export interface StatusThresholds {
	/** At or above this percent → `warning`. */
	warning: number;
	/** At or above this percent → `critical`. */
	critical: number;
}

export const DEFAULT_THRESHOLDS: StatusThresholds = {
	warning: 70,
	critical: 90,
};

/**
 * Dollar thresholds for the Requesty money metrics: a balance at or below
 * `balanceCriticalUsd` is critical and at or below `balanceWarningUsd` it warns; spend (24h/7d)
 * at or above `spendCriticalUsd` is critical and at or above `spendWarningUsd` it warns.
 * Configurable later via the Property Inspector.
 */
export interface RequestyThresholds {
	/** At or below this USD balance → `warning`. */
	balanceWarningUsd: number;
	/** At or below this USD balance → `critical`. */
	balanceCriticalUsd: number;
	/** At or above this USD spend → `warning`. */
	spendWarningUsd: number;
	/** At or above this USD spend → `critical`. */
	spendCriticalUsd: number;
}

/** Default thresholds for {@link RequestyThresholds}. */
export const DEFAULT_REQUESTY_THRESHOLDS: RequestyThresholds = {
	balanceWarningUsd: 5,
	balanceCriticalUsd: 2,
	spendWarningUsd: 2,
	spendCriticalUsd: 5,
};

/** Options for a usage fetch. */
export interface GetUsageOptions {
	/** Bypass the cache TTL and fetch now (key press). */
	force?: boolean;
}

/**
 * A provider orchestrates credentials → fetch → normalize → cache for one AI tool and always
 * resolves to a {@link UsageSnapshot} — it never throws, surfacing failures as error/stale
 * statuses so the action/renderer can always draw something.
 */
export interface Provider {
	getUsage(options?: GetUsageOptions): Promise<UsageSnapshot>;
}
