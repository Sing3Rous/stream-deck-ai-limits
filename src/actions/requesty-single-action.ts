import { action, SingletonAction } from "@elgato/streamdeck";
import type {
	DidReceiveSettingsEvent,
	KeyAction,
	KeyDownEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { requestyCredentialScope } from "../providers/requesty/requesty-credentials.ts";
import { createRequestyProvider } from "../providers/requesty/requesty-provider.ts";
import type { Provider, UsageSnapshot } from "../providers/types.ts";
import { renderRequestySingleIcon } from "../render/requesty-single-icon.ts";
import { toDataUrl } from "../render/svg.ts";
import {
	resolveRequestySettings,
	resolveUsageSettings,
	sameResolvedSettings,
	type ResolvedRequestySettings,
	type ResolvedUsageSettings,
	type UsageActionSettings,
} from "../settings/usage-settings.ts";
import { logger } from "../utils/logger.ts";

interface KeyRuntime {
	action: KeyAction;
	provider: Provider;
	usageConfig: ResolvedUsageSettings;
	displayConfig: ResolvedRequestySettings;
	/** Data refresh timer (network, at the configured interval). */
	dataTimer: ReturnType<typeof setInterval>;
	/** Last snapshot, reused when only the display metric changes (no re-fetch). */
	lastSnapshot: UsageSnapshot | null;
}

/**
 * Requesty single-metric action: shows ONE money metric (balance, 24h spend, or 7d spend) at a
 * larger size. The metric is a *display* setting resolved per render, so switching it in the
 * Property Inspector re-renders the cached snapshot without refetching or rebuilding the
 * provider; the fetch settings (interval, dollar thresholds, credentials path) drive
 * {@link ensureRuntime}.
 */
@action({ UUID: "com.singerous.ai-limits.requesty-single" })
export class RequestySingleAction extends SingletonAction<UsageActionSettings> {
	private readonly instances = new Map<string, KeyRuntime>();

	override async onWillAppear(ev: WillAppearEvent<UsageActionSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}
		const runtime = this.ensureRuntime(ev.action, ev.payload.settings);
		await this.refresh(runtime, { force: false });
		this.startTimer(runtime);
	}

	override onWillDisappear(ev: WillDisappearEvent<UsageActionSettings>): void {
		const runtime = this.instances.get(ev.action.id);
		if (runtime) {
			clearInterval(runtime.dataTimer);
			this.instances.delete(ev.action.id);
		}
	}

	override async onKeyDown(ev: KeyDownEvent<UsageActionSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}
		const runtime = this.ensureRuntime(ev.action, ev.payload.settings);
		await this.refresh(runtime, { force: true });
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<UsageActionSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}
		const runtime = this.ensureRuntime(ev.action, ev.payload.settings);
		this.startTimer(runtime);
		await this.refresh(runtime, { force: false });
	}

	private ensureRuntime(keyAction: KeyAction, rawSettings: UsageActionSettings): KeyRuntime {
		const usageConfig = resolveUsageSettings(rawSettings);
		const displayConfig = resolveRequestySettings(rawSettings);
		const existing = this.instances.get(keyAction.id);

		// Rebuild the provider only when fetch-affecting settings changed (interval, dollar
		// thresholds, credentials path). A display-metric change keeps the provider and the
		// cached snapshot and just updates the render.
		if (!existing || !sameResolvedSettings(existing.usageConfig, usageConfig)) {
			if (existing) {
				clearInterval(existing.dataTimer);
			}
			const runtime: KeyRuntime = {
				action: keyAction,
				provider: createProvider(usageConfig),
				usageConfig,
				displayConfig,
				dataTimer: undefined as unknown as ReturnType<typeof setInterval>,
				lastSnapshot: existing?.lastSnapshot ?? null,
			};
			this.instances.set(keyAction.id, runtime);
			return runtime;
		}

		existing.action = keyAction; // keep the live action reference fresh
		existing.displayConfig = displayConfig;
		return existing;
	}

	private startTimer(runtime: KeyRuntime): void {
		clearInterval(runtime.dataTimer);
		runtime.dataTimer = setInterval(() => {
			void this.refresh(runtime, { force: false });
		}, runtime.usageConfig.intervalSec * 1000);
	}

	private async refresh(runtime: KeyRuntime, options: { force: boolean }): Promise<void> {
		let snapshot: UsageSnapshot;
		try {
			snapshot = await runtime.provider.getUsage({ force: options.force });
		} catch (err) {
			logger.error(`requesty-single usage failure: ${(err as Error)?.name ?? "Error"}`);
			snapshot = {
				provider: "requesty",
				session: { usedPercent: null, resetAt: null },
				weekly: { usedPercent: null, resetAt: null },
				status: "error",
				updatedAt: new Date().toISOString(),
				stale: false,
			};
		}
		runtime.lastSnapshot = snapshot;
		await this.draw(runtime, snapshot);
	}

	private async draw(runtime: KeyRuntime, snapshot: UsageSnapshot): Promise<void> {
		const svg = renderRequestySingleIcon(snapshot, runtime.displayConfig.requestyMetric);
		await runtime.action.setImage(toDataUrl(svg));
	}
}

function createProvider(usage: ResolvedUsageSettings): Provider {
	return createRequestyProvider({
		ttlMs: usage.intervalSec * 1000,
		thresholds: usage.requestyThresholds,
		customCredentialsPath: usage.customCredentialsPath,
		// Scopes the shared cache to the credential source + thresholds (see
		// createRequestyProvider), so key swaps and threshold edits isolate cache entries.
		credentialScope: requestyCredentialScope(usage.customCredentialsPath),
		logger,
	});
}
