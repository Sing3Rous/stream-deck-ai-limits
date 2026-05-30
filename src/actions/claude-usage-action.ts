import { action, KeyDownEvent, SingletonAction, WillAppearEvent } from "@elgato/streamdeck";

/**
 * Phase 1 — static Claude Usage action.
 *
 * This deliberately renders a hard-coded SVG so we can validate the Stream Deck lifecycle
 * (appear / key press / setImage) in isolation, before wiring real credentials and the usage
 * API. The inline SVG here is a temporary stand-in: Phase 2 replaces it with a dedicated
 * renderer (`render/usage-icon.ts`) driven by a normalized `UsageSnapshot`.
 */
@action({ UUID: "com.singerous.ai-limits.claude-usage" })
export class ClaudeUsageAction extends SingletonAction<ClaudeUsageSettings> {
	/**
	 * Render a static icon as soon as the key becomes visible (startup, page/folder switch).
	 */
	override onWillAppear(ev: WillAppearEvent<ClaudeUsageSettings>): Promise<void> {
		const { sessionPercent, weeklyPercent } = withDefaults(ev.payload.settings);
		return ev.action.setImage(toDataUrl(renderStaticIcon(sessionPercent, weeklyPercent)));
	}

	/**
	 * On press, bump the static numbers so we can confirm `setImage` updates the key live.
	 * This is throwaway interaction — Phase 7 turns the press into a real force-refresh.
	 */
	override async onKeyDown(ev: KeyDownEvent<ClaudeUsageSettings>): Promise<void> {
		const { sessionPercent, weeklyPercent } = withDefaults(ev.payload.settings);
		const next: ClaudeUsageSettings = {
			sessionPercent: (sessionPercent + 7) % 101,
			weeklyPercent: (weeklyPercent + 4) % 101,
		};
		await ev.action.setSettings(next);
		await ev.action.setImage(toDataUrl(renderStaticIcon(next.sessionPercent!, next.weeklyPercent!)));
	}
}

/**
 * Persisted settings for the static Phase 1 action. Real settings (refresh interval,
 * thresholds, credentials path) arrive in Phase 8.
 */
type ClaudeUsageSettings = {
	sessionPercent?: number;
	weeklyPercent?: number;
};

function withDefaults(settings: ClaudeUsageSettings): { sessionPercent: number; weeklyPercent: number } {
	return {
		sessionPercent: settings.sessionPercent ?? 73,
		weeklyPercent: settings.weeklyPercent ?? 44,
	};
}

/**
 * Temporary inline SVG. Square 144x144 icon split into a 5-hour (top) and weekly (bottom)
 * half, each with a label, percentage, and a progress bar. Replaced by the real renderer in
 * Phase 2.
 */
function renderStaticIcon(sessionPercent: number, weeklyPercent: number): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" fill="#1c1c1e"/>
  ${row(8, "5H", sessionPercent)}
  <line x1="12" y1="72" x2="132" y2="72" stroke="#3a3a3c" stroke-width="1"/>
  ${row(80, "W", weeklyPercent)}
</svg>`;
}

function row(top: number, label: string, percent: number): string {
	const clamped = Math.max(0, Math.min(100, Math.round(percent)));
	const barWidth = Math.round((120 * clamped) / 100);
	return `
  <text x="12" y="${top + 22}" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="#f2f2f7">${label}</text>
  <text x="132" y="${top + 22}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="#f2f2f7">${clamped}%</text>
  <rect x="12" y="${top + 34}" width="120" height="12" rx="6" fill="#3a3a3c"/>
  <rect x="12" y="${top + 34}" width="${barWidth}" height="12" rx="6" fill="#0a84ff"/>`;
}

/**
 * Encode an SVG string as a data URL accepted by {@link KeyAction.setImage}.
 */
function toDataUrl(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
}
