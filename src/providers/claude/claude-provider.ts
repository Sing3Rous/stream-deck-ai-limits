import { UsageCache } from "../../cache/ttl-cache.ts";
import { authRequired } from "../../utils/errors.ts";
import type { SafeLogger } from "../../utils/logger.ts";
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

/**
 * Injectable dependencies — real implementations by default, overridable in tests.
 */
export interface ClaudeProviderDeps {
	readCredentials: (customPath?: string) => Promise<ClaudeCredentials>;
	fetchUsage: (accessToken: string) => Promise<Awaited<ReturnType<typeof fetchClaudeUsage>>>;
	now: () => number;
}

const defaultDeps: ClaudeProviderDeps = {
	readCredentials: readClaudeCredentials,
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
 * Claude provider: assembles credentials → fetch → normalize; Claude Code owns token renewal,
 * all behind the shared {@link UsageCache}. Always resolves to a {@link UsageSnapshot}.
 */
export class ClaudeProvider implements Provider {
	private readonly cache: UsageCache;
	private readonly thresholds: StatusThresholds;
	private readonly customCredentialsPath?: string;
	private readonly log?: SafeLogger;
	private readonly deps: ClaudeProviderDeps;

	constructor(options: ClaudeProviderOptions) {
		this.cache = options.cache;
		this.thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
		this.customCredentialsPath = options.customCredentialsPath;
		this.log = options.logger;
		this.deps = { ...defaultDeps, ...options.deps };
	}

	async getUsage(options: GetUsageOptions = {}): Promise<UsageSnapshot> {
		const snapshot = await this.cache.get(() => this.runPipeline(), { force: options.force });
		this.log?.info(`claude usage: status=${snapshot.status} stale=${snapshot.stale}`);
		return snapshot;
	}

	/**
	 * Read CLI-owned credentials on each uncached poll. Never exchange its refresh token:
	 * doing so can invalidate the token Claude Code still has on disk or in Keychain.
	 * Expiry and 401 keep any cached usage stale until Claude Code renews the login.
	 */
	private async runPipeline(): Promise<UsageSnapshot> {
		const creds = await this.deps.readCredentials(this.customCredentialsPath);
		const renewalMessage = "Open Claude Code to renew usage access; the next poll will read its updated credentials.";
		if (isExpired(creds.expiresAt, undefined, this.deps.now())) {
			throw authRequired(renewalMessage);
		}

		let raw;
		try {
			raw = await this.deps.fetchUsage(creds.accessToken);
		} catch (err) {
			if (err instanceof UnauthorizedError) {
				throw authRequired(renewalMessage);
			}
			throw err;
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
