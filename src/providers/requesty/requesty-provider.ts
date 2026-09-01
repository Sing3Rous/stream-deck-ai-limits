import { DEFAULT_TTL_MS, getSharedCache, UsageCache } from "../../cache/ttl-cache.ts";
import { authRequired } from "../../utils/errors.ts";
import { noopLogger, type SafeLogger } from "../../utils/logger.ts";
import type { GetUsageOptions, Provider, RequestyThresholds, UsageSnapshot } from "../types.ts";
import { DEFAULT_REQUESTY_THRESHOLDS } from "../types.ts";
import { fetchRequestyOrg, fetchRequestyUsage, UnauthorizedError } from "./requesty-api-client.ts";
import { readRequestyCredentials, type RequestyCredentials } from "./requesty-credentials.ts";
import { normalizeRequestyUsage } from "./requesty-normalizer.ts";

/**
 * Injectable dependencies — real implementations by default, overridable in tests.
 */
export interface RequestyProviderDeps {
	readCredentials: (customPath?: string) => Promise<RequestyCredentials>;
	fetchOrg: (apiKey: string) => Promise<Awaited<ReturnType<typeof fetchRequestyOrg>>>;
	fetchUsage: (apiKey: string, now: Date) => Promise<Awaited<ReturnType<typeof fetchRequestyUsage>>>;
	now: () => number;
}

const defaultDeps: RequestyProviderDeps = {
	readCredentials: readRequestyCredentials,
	fetchOrg: fetchRequestyOrg,
	fetchUsage: fetchRequestyUsage,
	now: Date.now,
};

export interface RequestyProviderOptions {
	cache: UsageCache;
	thresholds?: RequestyThresholds;
	customCredentialsPath?: string;
	logger?: SafeLogger;
	/** Test seam: override pipeline dependencies. */
	deps?: Partial<RequestyProviderDeps>;
}

/**
 * Requesty provider: credentials → fetch (org + usage) → normalize, all behind the shared
 * {@link UsageCache}. Always resolves to a {@link UsageSnapshot}.
 *
 * A 401 (stale/revoked key) re-reads the credentials — the key may have been rotated or the
 * env var changed — and retries the failed call exactly once before surfacing `auth_required`.
 */
export class RequestyProvider implements Provider {
	private readonly cache: UsageCache;
	private readonly thresholds: RequestyThresholds;
	private readonly customCredentialsPath?: string;
	private readonly log: SafeLogger;
	private readonly deps: RequestyProviderDeps;

	constructor(options: RequestyProviderOptions) {
		this.cache = options.cache;
		this.thresholds = options.thresholds ?? DEFAULT_REQUESTY_THRESHOLDS;
		this.customCredentialsPath = options.customCredentialsPath;
		this.log = options.logger ?? noopLogger;
		this.deps = { ...defaultDeps, ...options.deps };
	}

	async getUsage(options: GetUsageOptions = {}): Promise<UsageSnapshot> {
		const snapshot = await this.cache.get(() => this.runPipeline(), { force: options.force });
		this.log.info(`requesty usage: status=${snapshot.status} stale=${snapshot.stale}`);
		return snapshot;
	}

	/**
	 * The fetch pipeline. May throw a {@link UsageError} (mapped to a snapshot by the cache).
	 * 401 is handled here: one credentials re-read + retry before giving up as `auth_required`.
	 */
	private async runPipeline(): Promise<UsageSnapshot> {
		const creds = await this.deps.readCredentials(this.customCredentialsPath);
		const now = new Date(this.deps.now());
		const [org, usage] = await Promise.all([
			this.fetchWithRetry(creds.apiKey, (key) => this.deps.fetchOrg(key)),
			this.fetchWithRetry(creds.apiKey, (key) => this.deps.fetchUsage(key, now)),
		]);
		return normalizeRequestyUsage(org, usage, this.thresholds, now);
	}

	/** Run one fetch, re-reading credentials and retrying exactly once on a 401. */
	private async fetchWithRetry<T>(apiKey: string, fetch: (key: string) => Promise<T>): Promise<T> {
		try {
			return await fetch(apiKey);
		} catch (err) {
			if (!(err instanceof UnauthorizedError)) {
				throw err;
			}
			// Key may have been rotated since we read it → re-read and retry once.
			this.log.debug("requesty usage 401; re-reading credentials and retrying once");
			const refreshed = await this.deps.readCredentials(this.customCredentialsPath);
			try {
				return await fetch(refreshed.apiKey);
			} catch (retryErr) {
				if (retryErr instanceof UnauthorizedError) {
					throw authRequired(
						"Requesty API key was rejected. Check REQUESTY_API_KEY or ~/.requesty/api-key.",
					);
				}
				throw retryErr;
			}
		}
	}
}

/**
 * Convenience factory wiring real dependencies and a shared cache for one Requesty action. The
 * shared cache is scoped to the effective credential source and the dollar thresholds, so a key
 * swap or threshold change isolates (and re-creates) its cache entry instead of sharing stale
 * data with other configurations.
 */
export function createRequestyProvider(options: {
	ttlMs?: number;
	thresholds?: RequestyThresholds;
	customCredentialsPath?: string;
	/** Stable identity of the credential source in effect (custom:<path> | env | default). */
	credentialScope?: string;
	logger?: SafeLogger;
}): RequestyProvider {
	const cache = getSharedCache("requesty", options.ttlMs ?? DEFAULT_TTL_MS, {
		credentialScope: options.credentialScope,
		requestyThresholds: options.thresholds,
	});
	return new RequestyProvider({
		cache,
		thresholds: options.thresholds,
		customCredentialsPath: options.customCredentialsPath,
		logger: options.logger,
	});
}
