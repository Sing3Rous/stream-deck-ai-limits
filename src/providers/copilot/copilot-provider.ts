import { DEFAULT_TTL_MS, getSharedCache, UsageCache } from "../../cache/ttl-cache.ts";
import { authRequired } from "../../utils/errors.ts";
import { noopLogger, type SafeLogger } from "../../utils/logger.ts";
import type { GetUsageOptions, Provider, StatusThresholds, UsageSnapshot } from "../types.ts";
import { DEFAULT_THRESHOLDS } from "../types.ts";
import { fetchCopilotUsage, UnauthorizedError } from "./copilot-api-client.ts";
import { readCopilotCredentials, type CopilotCredentials } from "./copilot-credentials.ts";
import { normalizeCopilotUsage } from "./copilot-normalizer.ts";

/**
 * Injectable dependencies — real implementations by default, overridable in tests.
 */
export interface CopilotProviderDeps {
	readCredentials: (customPath?: string) => Promise<CopilotCredentials>;
	fetchUsage: (accessToken: string) => Promise<Awaited<ReturnType<typeof fetchCopilotUsage>>>;
	now: () => number;
}

const defaultDeps: CopilotProviderDeps = {
	readCredentials: readCopilotCredentials,
	fetchUsage: fetchCopilotUsage,
	now: Date.now,
};

export interface CopilotProviderOptions {
	cache: UsageCache;
	thresholds?: StatusThresholds;
	customCredentialsPath?: string;
	logger?: SafeLogger;
	/** Test seam: override pipeline dependencies. */
	deps?: Partial<CopilotProviderDeps>;
}

/**
 * Copilot provider: credentials → fetch → normalize, all behind the shared {@link UsageCache}.
 * Always resolves to a {@link UsageSnapshot}.
 *
 * A 401 (stale/revoked token) re-reads the credentials — the GitHub CLI's token may have been
 * refreshed by `gh auth login` — and retries exactly once before surfacing `auth_required`.
 */
export class CopilotProvider implements Provider {
	private readonly cache: UsageCache;
	private readonly thresholds: StatusThresholds;
	private readonly customCredentialsPath?: string;
	private readonly log: SafeLogger;
	private readonly deps: CopilotProviderDeps;

	constructor(options: CopilotProviderOptions) {
		this.cache = options.cache;
		this.thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
		this.customCredentialsPath = options.customCredentialsPath;
		this.log = options.logger ?? noopLogger;
		this.deps = { ...defaultDeps, ...options.deps };
	}

	async getUsage(options: GetUsageOptions = {}): Promise<UsageSnapshot> {
		const snapshot = await this.cache.get(() => this.runPipeline(), { force: options.force });
		this.log.info(`copilot usage: status=${snapshot.status} stale=${snapshot.stale}`);
		return snapshot;
	}

	/**
	 * The fetch pipeline. May throw a {@link UsageError} (mapped to a snapshot by the cache).
	 * 401 is handled here: one credentials re-read + retry before giving up as `auth_required`.
	 */
	private async runPipeline(): Promise<UsageSnapshot> {
		const creds = await this.deps.readCredentials(this.customCredentialsPath);

		let raw;
		try {
			raw = await this.deps.fetchUsage(creds.accessToken);
		} catch (err) {
			if (err instanceof UnauthorizedError) {
				// Token may have been refreshed since we read it → re-read and retry once.
				this.log.debug("copilot usage 401; re-reading credentials and retrying once");
				const refreshed = await this.deps.readCredentials(this.customCredentialsPath);
				try {
					raw = await this.deps.fetchUsage(refreshed.accessToken);
				} catch (retryErr) {
					if (retryErr instanceof UnauthorizedError) {
						throw authRequired("Copilot session expired. Log in with the GitHub CLI (gh auth login).");
					}
					throw retryErr;
				}
			} else {
				throw err;
			}
		}

		return normalizeCopilotUsage(raw, this.thresholds, new Date(this.deps.now()));
	}
}

/**
 * Convenience factory wiring real dependencies and a shared cache for one Copilot action.
 */
export function createCopilotProvider(options: {
	ttlMs?: number;
	thresholds?: StatusThresholds;
	customCredentialsPath?: string;
	logger?: SafeLogger;
}): CopilotProvider {
	const cache = getSharedCache("copilot", options.ttlMs ?? DEFAULT_TTL_MS, {
		customCredentialsPath: options.customCredentialsPath,
		thresholds: options.thresholds ?? DEFAULT_THRESHOLDS,
	});
	return new CopilotProvider({
		cache,
		thresholds: options.thresholds,
		customCredentialsPath: options.customCredentialsPath,
		logger: options.logger,
	});
}
