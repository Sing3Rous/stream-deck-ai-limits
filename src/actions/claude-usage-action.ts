import { action, SingletonAction } from "@elgato/streamdeck";
import type { KeyDownEvent, WillAppearEvent } from "@elgato/streamdeck";

import type { UsageSnapshot } from "../providers/types.ts";
import { renderUsageIcon, toDataUrl } from "../render/usage-icon.ts";

/**
 * Phase 2 — Claude Usage action driven by the dedicated renderer.
 *
 * Still no real data: the action cycles through representative {@link UsageSnapshot} states so
 * the renderer and its color/fallback handling can be validated on-device. Phase 7 replaces
 * the canned snapshots with the live Claude provider.
 */
@action({ UUID: "com.singerous.ai-limits.claude-usage" })
export class ClaudeUsageAction extends SingletonAction<ClaudeUsageSettings> {
	override onWillAppear(ev: WillAppearEvent<ClaudeUsageSettings>): Promise<void> {
		const index = ev.payload.settings.demoIndex ?? 0;
		return ev.action.setImage(toDataUrl(renderUsageIcon(demoSnapshots[index % demoSnapshots.length])));
	}

	/** Cycle to the next demo state so every visual state can be checked by pressing the key. */
	override async onKeyDown(ev: KeyDownEvent<ClaudeUsageSettings>): Promise<void> {
		const next = ((ev.payload.settings.demoIndex ?? 0) + 1) % demoSnapshots.length;
		await ev.action.setSettings({ demoIndex: next });
		await ev.action.setImage(toDataUrl(renderUsageIcon(demoSnapshots[next])));
	}
}

type ClaudeUsageSettings = {
	demoIndex?: number;
};

/** Build a demo snapshot with given percentages; status derived to exercise color bands. */
function demo(session: number, weekly: number, partial?: Partial<UsageSnapshot>): UsageSnapshot {
	const worst = Math.max(session, weekly);
	const status =
		worst >= 100 ? "limited" : worst >= 90 ? "critical" : worst >= 70 ? "warning" : "ok";
	return {
		provider: "claude",
		session: { usedPercent: session, resetAt: null },
		weekly: { usedPercent: weekly, resetAt: null },
		status,
		updatedAt: new Date().toISOString(),
		stale: false,
		...partial,
	};
}

/** Representative states cycled through on key press (matches the plan's visual test list). */
const demoSnapshots: UsageSnapshot[] = [
	demo(0, 0),
	demo(73, 44),
	demo(89, 60),
	demo(95, 80),
	demo(100, 92),
	demo(73, 44, { status: "stale", stale: true }),
	{
		provider: "claude",
		session: { usedPercent: null, resetAt: null },
		weekly: { usedPercent: null, resetAt: null },
		status: "auth_required",
		updatedAt: new Date().toISOString(),
		stale: false,
	},
	{
		provider: "claude",
		session: { usedPercent: null, resetAt: null },
		weekly: { usedPercent: null, resetAt: null },
		status: "rate_limited",
		updatedAt: new Date().toISOString(),
		stale: false,
	},
	{
		provider: "claude",
		session: { usedPercent: null, resetAt: null },
		weekly: { usedPercent: null, resetAt: null },
		status: "error",
		updatedAt: new Date().toISOString(),
		stale: false,
		errorMessage: "demo error",
	},
];
