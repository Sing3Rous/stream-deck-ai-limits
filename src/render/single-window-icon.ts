import { statusForPercent } from "../providers/status.ts";
import type { StatusThresholds, UsageSnapshot, UsageWindow } from "../providers/types.ts";
import { DEFAULT_THRESHOLDS } from "../providers/types.ts";
import { formatCountdown, formatResetTime, type DateFormat } from "../utils/time.ts";
import { paletteForStatus, providerColors, type Palette } from "./colors.ts";
import { SIZE, escapeXml } from "./svg.ts";
import type { ProviderAccent, ResetDisplay, WindowKind } from "../settings/usage-settings.ts";

export interface SingleWindowOptions {
	window: WindowKind;
	resetDisplay: ResetDisplay;
	dateFormat: DateFormat;
	providerAccent: ProviderAccent;
	/** Injectable clock for the countdown (testability). */
	now?: Date;
}

const FONT = "Helvetica, Arial, sans-serif";

/**
 * Render a single usage window (one provider + one window) at a larger size, with the
 * percentage, a bar or donut, and optional reset date/countdown beneath.
 */
export function renderSingleWindowIcon(snapshot: UsageSnapshot, options: SingleWindowOptions): string {
	const status = snapshot.status;
	const label = `${providerLabel(snapshot.provider)} ${windowLabel(options.window)}`;
	const provider = providerColors(snapshot.provider);
	const accentMode = options.providerAccent;

	if (status === "auth_required" || status === "rate_limited" || status === "error") {
		return renderMessage(status, label);
	}

	const win = options.window === "weekly" ? snapshot.weekly : snapshot.session;
	if (win.usedPercent === null) {
		return renderMessage("error", label, "No Data");
	}

	const thresholds = snapshot.thresholds ?? DEFAULT_THRESHOLDS;
	const accent = paletteForStatus(statusForPercent(win.usedPercent, thresholds)).accent;
	const palette = paletteForStatus("ok");
	const resetLines = buildResetLines(win, options);
	const winText = windowLabel(options.window);

	const background = accentMode === "tint" ? provider.tint : palette.background;
	const frame =
		accentMode === "frame"
			? `<rect x="3" y="3" width="${SIZE - 6}" height="${SIZE - 6}" rx="14" fill="none" stroke="${provider.accent}" stroke-width="4"/>`
			: "";
	const staleDot = snapshot.stale
		? `<circle cx="${SIZE - 9}" cy="9" r="3" fill="${palette.textMuted}"><title>stale</title></circle>`
		: "";

	// Window label (5H/7D) gets the provider's brand color so it stands apart from the reset text.
	const winColor = provider.accent;
	// On a tinted background the default dark track is barely visible — use a light track instead.
	const trackColor = accentMode === "tint" ? "#b9b9be" : palette.track;
	const body = renderGauge(win.usedPercent, accent, palette, winText, winColor, trackColor, resetLines.length);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${background}"/>
  ${frame}
  ${body}
  ${resetText(resetLines, palette)}
  ${staleDot}
</svg>`;
}

/**
 * Gauge layout: a 270° arc (open at the bottom). The window label sits in the bottom gap; the
 * percentage is centered inside, sized to stay clear of the ring with padding.
 */
function renderGauge(
	percent: number,
	accent: string,
	palette: Palette,
	winText: string,
	winColor: string,
	trackColor: string,
	resetLineCount: number,
): string {
	const pct = clampPct(percent);
	const cx = SIZE / 2;
	const cy = resetLineCount === 2 ? 60 : resetLineCount === 1 ? 66 : 74;
	const r = 46;
	const stroke = 11;

	// Arc sweeps 270°: from 135° (lower-left) clockwise over the top to 45° (lower-right),
	// leaving a 90° gap at the bottom for the window label.
	const START = 135;
	const SWEEP = 270;
	const track = arcPath(cx, cy, r, START, SWEEP);
	const filledSweep = (SWEEP * pct) / 100;
	const fill = arcPath(cx, cy, r, START, filledSweep);

	// % font sized so the text box stays inside the inner radius with padding.
	const pctFont = pct >= 100 ? 26 : 30;

	return `
  <path d="${track}" fill="none" stroke="${trackColor}" stroke-width="${stroke}" stroke-linecap="round"/>
  ${pct > 0 ? `<path d="${fill}" fill="none" stroke="${accent}" stroke-width="${stroke}" stroke-linecap="round"/>` : ""}
  <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="${FONT}" font-size="${pctFont}" font-weight="800" fill="${accent}">${pct}<tspan font-size="${Math.round(pctFont * 0.5)}">%</tspan></text>
  <text x="${cx}" y="${cy + r - 1}" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="700" fill="${winColor}">${escapeXml(winText)}</text>`;
}

/**
 * Build an SVG arc path string. Angles in degrees, measured clockwise from the 3 o'clock
 * position with +y downward (SVG convention). `sweepDeg` is the clockwise extent.
 */
function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
	const start = polar(cx, cy, r, startDeg);
	const end = polar(cx, cy, r, startDeg + sweepDeg);
	const largeArc = sweepDeg > 180 ? 1 : 0;
	return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
	const rad = (deg * Math.PI) / 180;
	return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Build the 0-2 reset text lines based on resetDisplay. */
function buildResetLines(win: UsageWindow, options: SingleWindowOptions): string[] {
	const lines: string[] = [];
	const now = options.now ?? new Date();
	const datetime = formatResetTime(win.resetAt, options.dateFormat);
	const countdown = formatCountdown(win.resetAt, now);

	// No "resets" prefix — context makes it clear, and it saves horizontal space.
	if ((options.resetDisplay === "datetime" || options.resetDisplay === "both") && datetime) {
		lines.push(datetime);
	}
	if ((options.resetDisplay === "countdown" || options.resetDisplay === "both") && countdown) {
		lines.push(countdown === "now" ? "now" : `in ${countdown}`);
	}
	return lines;
}

function resetText(lines: string[], palette: Palette): string {
	if (lines.length === 0) {
		return "";
	}
	const startY = SIZE - (lines.length === 2 ? 26 : 12);
	return lines
		.map(
			(line, i) =>
				`<text x="${SIZE / 2}" y="${startY + i * 15}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="600" fill="${palette.textMuted}">${escapeXml(line)}</text>`,
		)
		.join("\n  ");
}

function renderMessage(status: UsageSnapshot["status"], label: string, override?: string): string {
	const palette = paletteForStatus(status);
	const msg = override ?? messageText(status);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${palette.background}"/>
  <rect x="6" y="6" width="${SIZE - 12}" height="${SIZE - 12}" rx="12" fill="none" stroke="${palette.accent}" stroke-width="4"/>
  <text x="${SIZE / 2}" y="${SIZE / 2 - 8}" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="700" fill="${palette.text}">${escapeXml(label)}</text>
  <text x="${SIZE / 2}" y="${SIZE / 2 + 18}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="700" fill="${palette.text}">${escapeXml(msg)}</text>
</svg>`;
}

function messageText(status: UsageSnapshot["status"]): string {
	switch (status) {
		case "auth_required":
			return "Login";
		case "rate_limited":
			return "Rate Limited";
		default:
			return "Error";
	}
}

function providerLabel(provider: UsageSnapshot["provider"]): string {
	return provider === "codex" ? "Codex" : "Claude";
}

function windowLabel(window: WindowKind): string {
	return window === "weekly" ? "7D" : "5H";
}

function clampPct(percent: number): number {
	return Math.max(0, Math.min(100, Math.round(percent)));
}
