import { action } from "@elgato/streamdeck";

import { getSharedCache } from "../cache/ttl-cache.ts";
import { CodexProvider } from "../providers/codex/codex-provider.ts";
import type { Provider, UsageProvider } from "../providers/types.ts";
import type { ResolvedUsageSettings } from "../settings/usage-settings.ts";
import { logger } from "../utils/logger.ts";
import { UsageActionBase } from "./usage-action-base.ts";

/** Codex Usage action — see {@link UsageActionBase} for the shared lifecycle. */
@action({ UUID: "com.singerous.ai-limits.codex-usage" })
export class CodexUsageAction extends UsageActionBase {
	protected readonly providerId: UsageProvider = "codex";

	protected createProvider(config: ResolvedUsageSettings): Provider {
		return new CodexProvider({
			// Shared per provider+interval so backoff/last-good persist across tab switches.
			cache: getSharedCache("codex", config.intervalSec * 1000),
			thresholds: config.thresholds,
			customCredentialsPath: config.customCredentialsPath,
			logger,
		});
	}
}
