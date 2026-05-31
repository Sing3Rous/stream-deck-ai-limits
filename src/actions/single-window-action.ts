import { action, SingletonAction } from "@elgato/streamdeck";
import type {
	DidReceiveSettingsEvent,
	KeyAction,
	KeyDownEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { getSharedCache } from "../cache/ttl-cache.ts";
import { ClaudeProvider } from "../providers/claude/claude-provider.ts";
import { CodexProvider } from "../providers/codex/codex-provider.ts";
import type { Provider, UsageSnapshot } from "../providers/types.ts";
import { renderSingleWindowIcon } from "../render/single-window-icon.ts";
import { toDataUrl } from "../render/svg.ts";
import {
	resolveSingleWindowSettings,
	resolveUsageSettings,
	sameResolvedSettings,
	sameSingleWindowSettings,
	type ResolvedSingleWindowSettings,
	type ResolvedUsageSettings,
	type UsageActionSettings,
} from "../settings/usage-settings.ts";
import { logger } from "../utils/logger.ts";

/** Countdown redraw cadence (no network) so the "in 7h 58m" text ticks smoothly. */
const COUNTDOWN_REDRAW_MS = 60_000;

interface KeyRuntime {
	action: KeyAction;
	provider: Provider;
	usageConfig: ResolvedUsageSettings;
	displayConfig: ResolvedSingleWindowSettings;
	/** Data refresh timer (network, at the configured interval). */
	dataTimer: ReturnType<typeof setInterval>;
	/** Countdown redraw timer (cache only, every minute). */
	tickTimer: ReturnType<typeof setInterval>;
	/** Last snapshot, reused by the countdown redraw without re-fetching. */
	lastSnapshot: UsageSnapshot | null;
}

/**
 * Single-window usage action: shows ONE provider + ONE window (e.g. "Claude 5H") at a larger
 * size, with the reset date/time and/or countdown. Provider, window, layout and reset display
 * are all chosen in the Property Inspector.
 */
@action({ UUID: "com.singerous.ai-limits.usage-single" })
export class SingleWindowAction extends SingletonAction<UsageActionSettings> {
	private readonly instances = new Map<string, KeyRuntime>();

	override async onWillAppear(ev: WillAppearEvent<UsageActionSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}
		const runtime = this.ensureRuntime(ev.action, ev.payload.settings);
		await this.refresh(runtime, { force: false });
		this.startTimers(runtime);
	}

	override onWillDisappear(ev: WillDisappearEvent<UsageActionSettings>): void {
		const runtime = this.instances.get(ev.action.id);
		if (runtime) {
			clearInterval(runtime.dataTimer);
			clearInterval(runtime.tickTimer);
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
		this.startTimers(runtime);
		await this.refresh(runtime, { force: false });
	}

	private ensureRuntime(keyAction: KeyAction, rawSettings: UsageActionSettings): KeyRuntime {
		const usageConfig = resolveUsageSettings(rawSettings);
		const displayConfig = resolveSingleWindowSettings(rawSettings);
		const existing = this.instances.get(keyAction.id);

		const configChanged =
			!existing ||
			!sameResolvedSettings(existing.usageConfig, usageConfig) ||
			!sameSingleWindowSettings(existing.displayConfig, displayConfig);

		if (configChanged) {
			if (existing) {
				clearInterval(existing.dataTimer);
				clearInterval(existing.tickTimer);
			}
			const runtime: KeyRuntime = {
				action: keyAction,
				provider: createProvider(displayConfig, usageConfig),
				usageConfig,
				displayConfig,
				dataTimer: undefined as unknown as ReturnType<typeof setInterval>,
				tickTimer: undefined as unknown as ReturnType<typeof setInterval>,
				lastSnapshot: existing?.lastSnapshot ?? null,
			};
			this.instances.set(keyAction.id, runtime);
			return runtime;
		}

		existing.action = keyAction;
		return existing;
	}

	private startTimers(runtime: KeyRuntime): void {
		clearInterval(runtime.dataTimer);
		clearInterval(runtime.tickTimer);
		runtime.dataTimer = setInterval(() => {
			void this.refresh(runtime, { force: false });
		}, runtime.usageConfig.intervalSec * 1000);
		// Redraw the countdown each minute from the cached snapshot (no network).
		runtime.tickTimer = setInterval(() => {
			if (runtime.lastSnapshot) {
				void this.draw(runtime, runtime.lastSnapshot);
			}
		}, COUNTDOWN_REDRAW_MS);
	}

	private async refresh(runtime: KeyRuntime, options: { force: boolean }): Promise<void> {
		let snapshot: UsageSnapshot;
		try {
			snapshot = await runtime.provider.getUsage({ force: options.force });
		} catch (err) {
			logger.error(`single-window usage failure: ${(err as Error)?.name ?? "Error"}`);
			snapshot = {
				provider: runtime.displayConfig.provider,
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
		const svg = renderSingleWindowIcon(snapshot, {
			window: runtime.displayConfig.window,
			resetDisplay: runtime.displayConfig.resetDisplay,
			dateFormat: runtime.displayConfig.dateFormat,
			providerAccent: runtime.displayConfig.providerAccent,
		});
		await runtime.action.setImage(toDataUrl(svg));
	}
}

function createProvider(display: ResolvedSingleWindowSettings, usage: ResolvedUsageSettings): Provider {
	const ttlMs = usage.intervalSec * 1000;
	if (display.provider === "codex") {
		return new CodexProvider({
			cache: getSharedCache("codex", ttlMs),
			thresholds: usage.thresholds,
			customCredentialsPath: usage.customCredentialsPath,
			logger,
		});
	}
	return new ClaudeProvider({
		cache: getSharedCache("claude", ttlMs),
		thresholds: usage.thresholds,
		customCredentialsPath: usage.customCredentialsPath,
		logger,
	});
}
