import { UsageCache } from "../../cache/ttl-cache.ts";
import { authRequired } from "../../utils/errors.ts";
import { noopLogger, type SafeLogger } from "../../utils/logger.ts";
import type {
	GetUsageOptions,
	Provider,
	StatusThresholds,
	UsageSnapshot,
} from "../types.ts";
import { DEFAULT_THRESHOLDS } from "../types.ts";
import { fetchClaudeUsage, UnauthorizedError } from "./claude-api-client.ts";
import { isExpired, readClaudeCredentials, type ClaudeCredentials } from "./claude-credentials.ts";
import { normalizeClaudeUsage } from "./claude-normalizer.ts";
import { refreshClaudeToken } from "./claude-oauth.ts";

/**
 * Injectable dependencies — real implementations by default, overridable in tests.
 */
export interface ClaudeProviderDeps {
	readCredentials: (customPath?: string) => Promise<ClaudeCredentials>;
	refreshToken: (refreshToken: string | null) => Promise<{ accessToken: string }>;
	fetchUsage: (accessToken: string) => Promise<Awaited<ReturnType<typeof fetchClaudeUsage>>>;
	now: () => number;
}

const defaultDeps: ClaudeProviderDeps = {
	readCredentials: readClaudeCredentials,
	refreshToken: refreshClaudeToken,
	fetchUsage: fetchClaudeUsage,
	now: Date.now,
};

export interface ClaudeProviderOptions {
	cache: UsageCache;
	thresholds?: StatusThresholds;
	customCredentialsPath?: string;
	logger?: SafeLogger;
	/** Test seam: override pipeline dependencies. */
	deps?: Partial<ClaudeProviderDeps>;
}

/**
 * Claude provider: assembles credentials → (refresh) → fetch → (401 refresh+retry) → normalize,
 * all behind the shared {@link UsageCache}. Always resolves to a {@link UsageSnapshot}.
 */
export class ClaudeProvider implements Provider {
	private readonly cache: UsageCache;
	private readonly thresholds: StatusThresholds;
	private readonly customCredentialsPath?: string;
	private readonly log: SafeLogger;
	private readonly deps: ClaudeProviderDeps;

	constructor(options: ClaudeProviderOptions) {
		this.cache = options.cache;
		this.thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
		this.customCredentialsPath = options.customCredentialsPath;
		this.log = options.logger ?? noopLogger;
		this.deps = { ...defaultDeps, ...options.deps };
	}

	async getUsage(options: GetUsageOptions = {}): Promise<UsageSnapshot> {
		const snapshot = await this.cache.get(() => this.runPipeline(), { force: options.force });
		this.log.info(`claude usage: status=${snapshot.status} stale=${snapshot.stale}`);
		return snapshot;
	}

	/**
	 * The fetch pipeline. May throw a {@link UsageError} (mapped to a snapshot by the cache).
	 * 401 is handled here: one token refresh + retry before giving up as `auth_required`.
	 */
	private async runPipeline(): Promise<UsageSnapshot> {
		const creds = await this.deps.readCredentials(this.customCredentialsPath);

		let accessToken = creds.accessToken;
		if (isExpired(creds.expiresAt, undefined, this.deps.now())) {
			this.log.debug("claude token expired; refreshing");
			accessToken = (await this.deps.refreshToken(creds.refreshToken)).accessToken;
		}

		let raw;
		try {
			raw = await this.deps.fetchUsage(accessToken);
		} catch (err) {
			if (err instanceof UnauthorizedError) {
				// Token may have just gone stale → refresh once and retry exactly once.
				this.log.debug("claude usage 401; refreshing and retrying once");
				const refreshed = await this.deps.refreshToken(creds.refreshToken);
				try {
					raw = await this.deps.fetchUsage(refreshed.accessToken);
				} catch (retryErr) {
					if (retryErr instanceof UnauthorizedError) {
						throw authRequired("Claude session expired. Log in with Claude Code again.");
					}
					throw retryErr;
				}
			} else {
				throw err;
			}
		}

		return normalizeClaudeUsage(raw, this.thresholds, new Date(this.deps.now()));
	}
}

/**
 * Convenience factory wiring real dependencies and a fresh cache for one Claude action.
 */
export function createClaudeProvider(options: {
	ttlMs?: number;
	thresholds?: StatusThresholds;
	customCredentialsPath?: string;
	logger?: SafeLogger;
}): ClaudeProvider {
	const cache = new UsageCache({ provider: "claude", ttlMs: options.ttlMs });
	return new ClaudeProvider({
		cache,
		thresholds: options.thresholds,
		customCredentialsPath: options.customCredentialsPath,
		logger: options.logger,
	});
}
