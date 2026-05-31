import { SingletonAction } from "@elgato/streamdeck";
import type {
	DidReceiveSettingsEvent,
	KeyAction,
	KeyDownEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import type { Provider, UsageProvider, UsageSnapshot } from "../providers/types.ts";
import { renderUsageIcon, toDataUrl } from "../render/usage-icon.ts";
import {
	resolveUsageSettings,
	sameResolvedSettings,
	type ResolvedUsageSettings,
	type UsageActionSettings,
} from "../settings/usage-settings.ts";
import { logger } from "../utils/logger.ts";

/** Builds a fresh {@link Provider} for one key from its resolved settings. */
export type ProviderFactory = (config: ResolvedUsageSettings) => Provider;

interface KeyRuntime {
	action: KeyAction;
	provider: Provider;
	config: ResolvedUsageSettings;
	timer: ReturnType<typeof setInterval>;
}

/**
 * Shared lifecycle for a usage key (Claude or Codex).
 *
 * Each visible key gets its own {@link Provider} (with its own cache + timer). The timer and
 * cache TTL share the configured interval; a key press forces an immediate (throttled) refresh.
 * Property Inspector changes apply live, without a restart. Subclasses only supply the provider
 * id (for empty-state rendering/logging) and a factory.
 */
export abstract class UsageActionBase extends SingletonAction<UsageActionSettings> {
	private readonly instances = new Map<string, KeyRuntime>();

	protected abstract readonly providerId: UsageProvider;
	protected abstract createProvider(config: ResolvedUsageSettings): Provider;

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
			clearInterval(runtime.timer);
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

	/** Apply Property Inspector changes live: rebuild config, refresh, restart the timer. */
	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<UsageActionSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}
		const runtime = this.ensureRuntime(ev.action, ev.payload.settings);
		this.startTimer(runtime);
		await this.refresh(runtime, { force: false });
	}

	private ensureRuntime(keyAction: KeyAction, rawSettings: UsageActionSettings): KeyRuntime {
		const resolved = resolveUsageSettings(rawSettings);
		const existing = this.instances.get(keyAction.id);

		// Rebuild the provider only if config that affects fetching changed (or first appearance).
		if (!existing || !sameResolvedSettings(existing.config, resolved)) {
			if (existing) {
				clearInterval(existing.timer);
			}
			const runtime: KeyRuntime = {
				action: keyAction,
				provider: this.createProvider(resolved),
				config: resolved,
				timer: undefined as unknown as ReturnType<typeof setInterval>,
			};
			this.instances.set(keyAction.id, runtime);
			return runtime;
		}

		existing.action = keyAction; // keep the live action reference fresh
		return existing;
	}

	private startTimer(runtime: KeyRuntime): void {
		clearInterval(runtime.timer);
		runtime.timer = setInterval(() => {
			void this.refresh(runtime, { force: false });
		}, runtime.config.intervalSec * 1000);
	}

	private async refresh(runtime: KeyRuntime, options: { force: boolean }): Promise<void> {
		let snapshot: UsageSnapshot;
		try {
			snapshot = await runtime.provider.getUsage({ force: options.force });
		} catch (err) {
			// Providers are designed never to throw, but guard the UI regardless.
			logger.error(`${this.providerId} usage unexpected failure: ${(err as Error)?.name ?? "Error"}`);
			snapshot = {
				provider: this.providerId,
				session: { usedPercent: null, resetAt: null },
				weekly: { usedPercent: null, resetAt: null },
				status: "error",
				updatedAt: new Date().toISOString(),
				stale: false,
			};
		}
		await runtime.action.setImage(toDataUrl(renderUsageIcon(snapshot)));
	}
}
