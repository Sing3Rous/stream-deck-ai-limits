import { action } from "@elgato/streamdeck";

import { requestyCredentialScope } from "../providers/requesty/requesty-credentials.ts";
import { createRequestyProvider } from "../providers/requesty/requesty-provider.ts";
import type { Provider, UsageProvider } from "../providers/types.ts";
import type { ResolvedUsageSettings } from "../settings/usage-settings.ts";
import { logger } from "../utils/logger.ts";
import { UsageActionBase } from "./usage-action-base.ts";

/** Requesty Usage action — see {@link UsageActionBase} for the shared lifecycle. */
@action({ UUID: "com.singerous.ai-limits.requesty-usage" })
export class RequestyUsageAction extends UsageActionBase {
	protected readonly providerId: UsageProvider = "requesty";

	protected createProvider(config: ResolvedUsageSettings): Provider {
		return createRequestyProvider({
			ttlMs: config.intervalSec * 1000,
			thresholds: config.requestyThresholds,
			customCredentialsPath: config.customCredentialsPath,
			// Scopes the shared cache to the credential source + thresholds (see
			// createRequestyProvider), so key swaps and threshold edits isolate cache entries.
			credentialScope: requestyCredentialScope(config.customCredentialsPath),
			logger,
		});
	}
}
