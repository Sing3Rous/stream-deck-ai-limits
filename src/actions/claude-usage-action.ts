import { action, SingletonAction } from "@elgato/streamdeck";
import type {
	DidReceiveSettingsEvent,
	KeyAction,
	KeyDownEvent,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";

import { ClaudeProvider } from "../providers/claude/claude-provider.ts";
import { UsageCache } from "../cache/ttl-cache.ts";
import type { UsageSnapshot } from "../providers/types.ts";
import { renderUsageIcon, toDataUrl } from "../render/usage-icon.ts";
import {
	resolveClaudeSettings,
	type ClaudeActionSettings,
	type ResolvedClaudeSettings,
} from "../settings/claude-settings.ts";
import { logger } from "../utils/logger.ts";

/**
 * Claude Usage action — live data.
 *
 * Each visible key gets its own {@link ClaudeProvider} (with its own cache + timer). The timer
 * and cache TTL share the configured interval; a key press forces an immediate (throttled)
 * refresh. Settings changes from the Property Inspector apply live, without a restart.
 */
@action({ UUID: "com.singerous.ai-limits.claude-usage" })
export class ClaudeUsageAction extends SingletonAction<ClaudeActionSettings> {
	/** Per-key runtime state, keyed by action instance id. */
	private readonly instances = new Map<string, KeyRuntime>();

	override async onWillAppear(ev: WillAppearEvent<ClaudeActionSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}
		const runtime = this.ensureRuntime(ev.action, ev.payload.settings);
		await this.refresh(runtime, { force: false });
		this.startTimer(runtime);
	}

	override onWillDisappear(ev: WillDisappearEvent<ClaudeActionSettings>): void {
		const runtime = this.instances.get(ev.action.id);
		if (runtime) {
			clearInterval(runtime.timer);
			this.instances.delete(ev.action.id);
		}
	}

	override async onKeyDown(ev: KeyDownEvent<ClaudeActionSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}
		const runtime = this.ensureRuntime(ev.action, ev.payload.settings);
		await this.refresh(runtime, { force: true });
	}

	/** Apply Property Inspector changes live: rebuild config, refresh, restart the timer. */
	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ClaudeActionSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}
		const runtime = this.ensureRuntime(ev.action, ev.payload.settings);
		this.startTimer(runtime);
		await this.refresh(runtime, { force: false });
	}

	private ensureRuntime(keyAction: KeyAction, rawSettings: ClaudeActionSettings): KeyRuntime {
		const resolved = resolveClaudeSettings(rawSettings);
		const existing = this.instances.get(keyAction.id);

		// Rebuild the provider only if config that affects fetching changed (or first appearance).
		if (!existing || !sameConfig(existing.config, resolved)) {
			if (existing) {
				clearInterval(existing.timer);
			}
			const provider = new ClaudeProvider({
				cache: new UsageCache({ provider: "claude", ttlMs: resolved.intervalSec * 1000 }),
				thresholds: resolved.thresholds,
				customCredentialsPath: resolved.customCredentialsPath,
				logger,
			});
			const runtime: KeyRuntime = {
				action: keyAction,
				provider,
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
			// Provider is designed never to throw, but guard the UI regardless.
			logger.error(`claude usage unexpected failure: ${(err as Error)?.name ?? "Error"}`);
			snapshot = {
				provider: "claude",
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

interface KeyRuntime {
	action: KeyAction;
	provider: ClaudeProvider;
	config: ResolvedClaudeSettings;
	timer: ReturnType<typeof setInterval>;
}

function sameConfig(a: ResolvedClaudeSettings, b: ResolvedClaudeSettings): boolean {
	return (
		a.intervalSec === b.intervalSec &&
		a.customCredentialsPath === b.customCredentialsPath &&
		a.thresholds.warning === b.thresholds.warning &&
		a.thresholds.critical === b.thresholds.critical
	);
}
