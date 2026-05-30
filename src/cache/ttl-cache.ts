import { isUsageError } from "../utils/errors.ts";
import type { UsageProvider, UsageSnapshot } from "../providers/types.ts";

/** Default cache TTL and timer interval (see project decision: 60s default, 15s floor). */
export const DEFAULT_TTL_MS = 60_000;

/** After a 429, wait at least this long before hitting the network again (serve stale). */
export const RATE_LIMIT_BACKOFF_MS = 5 * 60_000;

/** Produces a fresh snapshot, or throws a {@link UsageError} on failure. */
export type SnapshotFetcher = () => Promise<UsageSnapshot>;

export interface GetOptions {
	/** Bypass the TTL and fetch now (used by key press). Backoff still applies for 429. */
	force?: boolean;
}

export interface UsageCacheOptions {
	/** Provider used for fallback snapshots when there is no cached value yet. */
	provider: UsageProvider;
	ttlMs?: number;
	rateLimitBackoffMs?: number;
	/** Injectable clock for tests. */
	now?: () => number;
}

/**
 * Single-provider usage cache.
 *
 * - Serves a cached snapshot while it is within the TTL.
 * - Dedupes concurrent fetches: parallel `get()` calls (e.g. several keys) share one request.
 * - On a failed refresh, returns the last good snapshot marked `stale`; if there is none, turns
 *   the error into an error-snapshot.
 * - After a rate-limit (429), suppresses network calls for `rateLimitBackoffMs`, serving stale.
 */
export class UsageCache {
	private readonly provider: UsageProvider;
	private readonly ttlMs: number;
	private readonly backoffMs: number;
	private readonly now: () => number;

	private last: UsageSnapshot | null = null;
	private lastFetchedAt = 0;
	private inFlight: Promise<UsageSnapshot> | null = null;
	private rateLimitedUntil = 0;

	constructor(options: UsageCacheOptions) {
		this.provider = options.provider;
		this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
		this.backoffMs = options.rateLimitBackoffMs ?? RATE_LIMIT_BACKOFF_MS;
		this.now = options.now ?? Date.now;
	}

	/** The last good snapshot, if any (without triggering a fetch). */
	get lastSnapshot(): UsageSnapshot | null {
		return this.last;
	}

	async get(fetcher: SnapshotFetcher, options: GetOptions = {}): Promise<UsageSnapshot> {
		const now = this.now();
		const fresh = this.last !== null && now - this.lastFetchedAt < this.ttlMs;

		// Within TTL and not forced → serve cache.
		if (fresh && !options.force) {
			return this.last as UsageSnapshot;
		}

		// Under rate-limit backoff → never hit the network, even on force. Serve stale if we can.
		if (now < this.rateLimitedUntil) {
			return this.staleOr(this.rateLimitedSnapshot());
		}

		// Dedupe: a concurrent caller already triggered the fetch.
		if (this.inFlight) {
			return this.inFlight;
		}

		this.inFlight = this.runFetch(fetcher);
		try {
			return await this.inFlight;
		} finally {
			this.inFlight = null;
		}
	}

	private async runFetch(fetcher: SnapshotFetcher): Promise<UsageSnapshot> {
		try {
			const snapshot = await fetcher();
			this.last = snapshot;
			this.lastFetchedAt = this.now();
			this.rateLimitedUntil = 0;
			return snapshot;
		} catch (err) {
			if (isUsageError(err) && err.status === "rate_limited") {
				this.rateLimitedUntil = this.now() + this.backoffMs;
				return this.staleOr(this.rateLimitedSnapshot(err.message));
			}
			return this.staleOr(this.errorToSnapshot(err));
		}
	}

	/** Return the last good snapshot marked stale, or the given fallback if none exists. */
	private staleOr(fallback: UsageSnapshot): UsageSnapshot {
		if (this.last !== null) {
			return {
				...this.last,
				status: "stale",
				stale: true,
				updatedAt: new Date(this.now()).toISOString(),
			};
		}
		return fallback;
	}

	private rateLimitedSnapshot(message?: string): UsageSnapshot {
		return { ...this.emptySnapshot("rate_limited"), errorMessage: message };
	}

	private errorToSnapshot(err: unknown): UsageSnapshot {
		const status = isUsageError(err) ? err.status : "error";
		const message = isUsageError(err) ? err.message : "Unexpected error.";
		return { ...this.emptySnapshot(status), errorMessage: message };
	}

	private emptySnapshot(status: UsageSnapshot["status"]): UsageSnapshot {
		return {
			provider: this.provider,
			session: { usedPercent: null, resetAt: null },
			weekly: { usedPercent: null, resetAt: null },
			status,
			updatedAt: new Date(this.now()).toISOString(),
			stale: false,
		};
	}
}
