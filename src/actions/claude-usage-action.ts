import { action } from "@elgato/streamdeck";

import { getSharedCache } from "../cache/ttl-cache.ts";
import { ClaudeProvider } from "../providers/claude/claude-provider.ts";
import type { Provider, UsageProvider } from "../providers/types.ts";
import type { ResolvedUsageSettings } from "../settings/usage-settings.ts";
import { logger } from "../utils/logger.ts";
import { UsageActionBase } from "./usage-action-base.ts";

/** Claude Usage action — see {@link UsageActionBase} for the shared lifecycle. */
@action({ UUID: "com.singerous.ai-limits.claude-usage" })
export class ClaudeUsageAction extends UsageActionBase {
	protected readonly providerId: UsageProvider = "claude";

	protected createProvider(config: ResolvedUsageSettings): Provider {
		return new ClaudeProvider({
			// Shared per provider+interval so backoff/last-good persist across tab switches.
			cache: getSharedCache("claude", config.intervalSec * 1000),
			thresholds: config.thresholds,
			customCredentialsPath: config.customCredentialsPath,
			logger,
		});
	}
}
