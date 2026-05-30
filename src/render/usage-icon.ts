import type { UsageSnapshot, UsageStatus, UsageWindow } from "../providers/types.ts";
import { paletteForStatus } from "./colors.ts";

/** Canvas size. 144x144 is the Stream Deck high-DPI key size; SVG scales to any device. */
const SIZE = 144;

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

	if (status === "auth_required" || status === "rate_limited" || status === "error") {
		return renderMessage(status, messageLines(status));
	}

	// No usable numbers at all → treat as a generic message even if status looked ok.
	if (snapshot.session.usedPercent === null && snapshot.weekly.usedPercent === null) {
		return renderMessage("error", ["Claude", "No", "Data"]);
	}

	return renderBars(snapshot);
}

/** Encode an SVG string as a data URL accepted by `KeyAction.setImage`. */
export function toDataUrl(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
}

function renderBars(snapshot: UsageSnapshot): string {
	const palette = paletteForStatus(snapshot.status);
	const markerText =
		snapshot.status === "stale" ? (snapshot.staleReason === "rate_limited" ? "RATE LIM" : "STALE") : "";
	const staleMarker = markerText
		? `<text x="${SIZE - 10}" y="${SIZE - 8}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="11" font-weight="700" fill="${palette.textMuted}">${markerText}</text>`
		: "";

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${palette.background}"/>
  ${barRow(8, "5H", snapshot.session, palette.text, palette.track, palette.accent)}
  <line x1="12" y1="72" x2="${SIZE - 12}" y2="72" stroke="${palette.track}" stroke-width="1"/>
  ${barRow(80, "W", snapshot.weekly, palette.text, palette.track, palette.accent)}
  ${staleMarker}
</svg>`;
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

function messageLines(status: UsageStatus): string[] {
	switch (status) {
		case "auth_required":
			return ["Claude", "Login", "Required"];
		case "rate_limited":
			return ["Claude", "Rate", "Limited"];
		case "error":
		default:
			return ["Claude", "Error"];
	}
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
