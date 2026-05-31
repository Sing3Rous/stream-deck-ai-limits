import { statusForPercent } from "../providers/status.ts";
import type { StatusThresholds, UsageSnapshot, UsageStatus, UsageWindow } from "../providers/types.ts";
import { DEFAULT_THRESHOLDS } from "../providers/types.ts";
import { paletteForStatus } from "./colors.ts";
import { SIZE, escapeXml, toDataUrl } from "./svg.ts";

export { toDataUrl };

/**
 * Render a usage snapshot to an SVG string.
 *
 * Two layouts:
 *  - **fallback** (full-key message) for `auth_required`, `rate_limited`, `error`, or when
 *    both windows lack data;
 *  - **bars** (5H + W with progress bars) for `ok`/`warning`/`critical`/`limited`/`stale`.
 *    A `stale` snapshot uses the bars layout with a small "STALE" marker.
 *
 * The renderer is provider-agnostic — it only reads the normalized {@link UsageSnapshot}.
 */
export function renderUsageIcon(snapshot: UsageSnapshot): string {
	const status = snapshot.status;
	const label = providerLabel(snapshot.provider);

	if (status === "auth_required" || status === "rate_limited" || status === "error") {
		return renderMessage(status, messageLines(status, label));
	}

	// No usable numbers at all → treat as a generic message even if status looked ok.
	if (snapshot.session.usedPercent === null && snapshot.weekly.usedPercent === null) {
		return renderMessage("error", [label, "No", "Data"]);
	}

	return renderBars(snapshot);
}

/** Short display name shown on the key for each provider. */
function providerLabel(provider: UsageSnapshot["provider"]): string {
	return provider === "codex" ? "Codex" : "Claude";
}

function renderBars(snapshot: UsageSnapshot): string {
	const thresholds = snapshot.thresholds ?? DEFAULT_THRESHOLDS;
	const stale = snapshot.status === "stale";

	// Stale data still shows real numbers with normal per-bar colors (the values are the
	// last-known-good ones) — only a tiny corner dot hints that a refresh is pending. This keeps
	// transient rate-limit windows from turning the whole key an alarming grey. We use the normal
	// (non-stale) palette for text/background so it reads as live data.
	const palette = paletteForStatus("ok");
	const sessionAccent = accentForWindow(snapshot.session, thresholds);
	const weeklyAccent = accentForWindow(snapshot.weekly, thresholds);

	const staleDot = stale
		? `<circle cx="${SIZE - 9}" cy="9" r="3" fill="${palette.textMuted}"><title>data is stale (refresh pending)</title></circle>`
		: "";

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${palette.background}"/>
  ${barRow(8, "5H", snapshot.session, palette.text, palette.track, sessionAccent)}
  <line x1="12" y1="72" x2="${SIZE - 12}" y2="72" stroke="${palette.track}" stroke-width="1"/>
  ${barRow(80, "W", snapshot.weekly, palette.text, palette.track, weeklyAccent)}
  ${staleDot}
</svg>`;
}

/** Accent color for one bar, derived from its own percentage and the configured thresholds. */
function accentForWindow(window: UsageWindow, thresholds: StatusThresholds): string {
	if (window.usedPercent === null) {
		return paletteForStatus("ok").accent;
	}
	return paletteForStatus(statusForPercent(window.usedPercent, thresholds)).accent;
}

function barRow(
	top: number,
	label: string,
	window: UsageWindow,
	textColor: string,
	trackColor: string,
	accentColor: string,
): string {
	const hasValue = window.usedPercent !== null;
	const clamped = hasValue ? Math.max(0, Math.min(100, Math.round(window.usedPercent as number))) : 0;
	const valueText = hasValue ? `${clamped}%` : "—";
	const barWidth = Math.round((120 * clamped) / 100);

	return `
  <text x="12" y="${top + 22}" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="${textColor}">${escapeXml(label)}</text>
  <text x="${SIZE - 12}" y="${top + 22}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="${textColor}">${escapeXml(valueText)}</text>
  <rect x="12" y="${top + 34}" width="120" height="12" rx="6" fill="${trackColor}"/>
  ${barWidth > 0 ? `<rect x="12" y="${top + 34}" width="${barWidth}" height="12" rx="6" fill="${accentColor}"/>` : ""}`;
}

function renderMessage(status: UsageStatus, lines: string[]): string {
	const palette = paletteForStatus(status);
	const startY = SIZE / 2 - ((lines.length - 1) * 26) / 2;
	const text = lines
		.map(
			(line, i) =>
				`<text x="${SIZE / 2}" y="${startY + i * 26 + 8}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="700" fill="${palette.text}">${escapeXml(line)}</text>`,
		)
		.join("\n  ");

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${palette.background}"/>
  <rect x="6" y="6" width="${SIZE - 12}" height="${SIZE - 12}" rx="12" fill="none" stroke="${palette.accent}" stroke-width="4"/>
  ${text}
</svg>`;
}

function messageLines(status: UsageStatus, label: string): string[] {
	switch (status) {
		case "auth_required":
			return [label, "Login", "Required"];
		case "rate_limited":
			return [label, "Rate", "Limited"];
		case "error":
		default:
			return [label, "Error"];
	}
}
