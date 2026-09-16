import { action } from "@elgato/streamdeck";

import { getSharedCache } from "../cache/ttl-cache.ts";
import { CopilotProvider } from "../providers/copilot/copilot-provider.ts";
import type { Provider, UsageProvider } from "../providers/types.ts";
import type { ResolvedUsageSettings } from "../settings/usage-settings.ts";
import { logger } from "../utils/logger.ts";
import { UsageActionBase } from "./usage-action-base.ts";

/** Copilot Usage action — see {@link UsageActionBase} for the shared lifecycle. */
@action({ UUID: "com.singerous.ai-limits.copilot-usage" })
export class CopilotUsageAction extends UsageActionBase {
	protected readonly providerId: UsageProvider = "copilot";

	protected createProvider(config: ResolvedUsageSettings): Provider {
		return new CopilotProvider({
			// Shared only by matching provider, interval, account, and thresholds.
			cache: getSharedCache("copilot", config.intervalSec * 1000, config),
			thresholds: config.thresholds,
			customCredentialsPath: config.customCredentialsPath,
			logger,
		});
	}
}
