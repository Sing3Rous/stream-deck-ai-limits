import { action, SingletonAction } from "@elgato/streamdeck";
import type { KeyAction, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";

import { ClaudeProvider } from "../providers/claude/claude-provider.ts";
import { UsageCache } from "../cache/ttl-cache.ts";
import type { StatusThresholds, UsageSnapshot } from "../providers/types.ts";
import { renderUsageIcon, toDataUrl } from "../render/usage-icon.ts";
import { logger } from "../utils/logger.ts";

/** Default / floor refresh cadence (see project decision: 60s default, 15s floor). */
const DEFAULT_INTERVAL_SEC = 60;
const MIN_INTERVAL_SEC = 15;

/**
 * Claude Usage action — live data.
 *
 * Each visible key gets its own {@link ClaudeProvider} (with its own cache + timer). The timer
 * and cache TTL share one interval; key press forces an immediate refresh.
 */
@action({ UUID: "com.singerous.ai-limits.claude-usage" })
export class ClaudeUsageAction extends SingletonAction<ClaudeUsageSettings> {
	/** Per-key runtime state, keyed by action instance id. */
	private readonly instances = new Map<string, KeyRuntime>();

	override async onWillAppear(ev: WillAppearEvent<ClaudeUsageSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}
		const runtime = this.ensureRuntime(ev.action, ev.payload.settings);
		await this.refresh(runtime, { force: false });
		this.startTimer(runtime);
	}

	override onWillDisappear(ev: WillDisappearEvent<ClaudeUsageSettings>): void {
		const runtime = this.instances.get(ev.action.id);
		if (runtime) {
			clearInterval(runtime.timer);
			this.instances.delete(ev.action.id);
		}
	}

	override async onKeyDown(ev: KeyDownEvent<ClaudeUsageSettings>): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}
		const runtime = this.ensureRuntime(ev.action, ev.payload.settings);
		await this.refresh(runtime, { force: true });
	}

	private ensureRuntime(keyAction: KeyAction, settings: ClaudeUsageSettings): KeyRuntime {
		const existing = this.instances.get(keyAction.id);
		const intervalSec = resolveIntervalSec(settings.refreshIntervalSec);
		const thresholds = resolveThresholds(settings);
		const customPath = settings.customCredentialsPath?.trim() || undefined;

		// Rebuild the provider if config that affects fetching changed (or first appearance).
		if (
			!existing ||
			existing.intervalSec !== intervalSec ||
			existing.customPath !== customPath ||
			existing.thresholds.warning !== thresholds.warning ||
			existing.thresholds.critical !== thresholds.critical
		) {
			if (existing) {
				clearInterval(existing.timer);
			}
			const provider = new ClaudeProvider({
				cache: new UsageCache({ provider: "claude", ttlMs: intervalSec * 1000 }),
				thresholds,
				customCredentialsPath: customPath,
				logger,
			});
			const runtime: KeyRuntime = {
				action: keyAction,
				provider,
				intervalSec,
				thresholds,
				customPath,
				timer: undefined as unknown as ReturnType<typeof setInterval>,
			};
			this.instances.set(keyAction.id, runtime);
			return runtime;
		}

		// Keep the live action reference fresh.
		existing.action = keyAction;
		return existing;
	}

	private startTimer(runtime: KeyRuntime): void {
		clearInterval(runtime.timer);
		runtime.timer = setInterval(() => {
			void this.refresh(runtime, { force: false });
		}, runtime.intervalSec * 1000);
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
	intervalSec: number;
	thresholds: StatusThresholds;
	customPath: string | undefined;
	timer: ReturnType<typeof setInterval>;
}

/**
 * Persisted settings. The Property Inspector that edits these arrives in Phase 8; until then
 * the defaults apply.
 */
type ClaudeUsageSettings = {
	refreshIntervalSec?: number;
	warningThreshold?: number;
	criticalThreshold?: number;
	customCredentialsPath?: string;
};

function resolveIntervalSec(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_INTERVAL_SEC;
	}
	return Math.max(MIN_INTERVAL_SEC, Math.round(value));
}

function resolveThresholds(settings: ClaudeUsageSettings): StatusThresholds {
	const warning = clampPercent(settings.warningThreshold, 70);
	const critical = clampPercent(settings.criticalThreshold, 90);
	// Ensure critical >= warning so the bands stay coherent.
	return { warning, critical: Math.max(warning, critical) };
}

function clampPercent(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(0, Math.min(100, Math.round(value)));
}
