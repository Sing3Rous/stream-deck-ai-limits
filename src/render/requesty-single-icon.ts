import { requestyMetricStatus } from "../providers/requesty/requesty-normalizer.ts";
import type { RequestyThresholds, UsageSnapshot } from "../providers/types.ts";
import { DEFAULT_REQUESTY_THRESHOLDS } from "../providers/types.ts";
import type { RequestyMetric } from "../settings/usage-settings.ts";
import { paletteForStatus, providerColors } from "./colors.ts";
import { SIZE, escapeXml } from "./svg.ts";

const FONT = "Helvetica, Arial, sans-serif";

/**
 * Render a single Requesty money metric at a larger size (the "Requesty Metric" action), with a
 * big $ value, a caption naming the metric, and the provider label. Mirrors the structure of
 * `single-window-icon.ts`. The value is colored by its own metric's status; a missing value
 * renders muted with a dash.
 *
 * @param snapshot The (possibly stale) usage snapshot to render.
 * @param metric   Which metric to highlight.
 */
export function renderRequestySingleIcon(snapshot: UsageSnapshot, metric: RequestyMetric): string {
	const label = providerLabel(snapshot.provider);
	const provider = providerColors(snapshot.provider);

	if (snapshot.status === "auth_required" || snapshot.status === "rate_limited" || snapshot.status === "error") {
		return renderMessage(snapshot.status, label);
	}

	const money = snapshot.requesty;
	if (!money) {
		return renderMessage("error", label, "No Data");
	}

	const value = metricValue(money, metric);
	const kind = metric === "balance" ? "balance" : "spend";
	const thresholds = money.thresholds ?? DEFAULT_REQUESTY_THRESHOLDS;
	const palette = paletteForStatus("ok");
	const statusColor = value === null ? palette.textMuted : moneyColor(value, kind, thresholds);
	const valueText = value === null ? "—" : `$${value.toFixed(2)}`;
	// Shrink the value so wide amounts ($1234.56) stay inside the key.
	const valueFont = valueText.length >= 8 ? 30 : valueText.length >= 6 ? 36 : 44;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${palette.background}"/>
  <rect x="3" y="3" width="${SIZE - 6}" height="${SIZE - 6}" rx="14" fill="none" stroke="${provider.accent}" stroke-width="4"/>
  <text x="${SIZE / 2}" y="38" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="700" fill="${provider.accent}">${escapeXml(label)}</text>
  <text x="${SIZE / 2}" y="94" text-anchor="middle" font-family="${FONT}" font-size="${valueFont}" font-weight="800" fill="${statusColor}">${escapeXml(valueText)}</text>
  <text x="${SIZE / 2}" y="124" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="600" fill="${palette.textMuted}">${escapeXml(metricCaption(metric))}</text>
</svg>`;
}

/** Accent color for one money metric, derived from its value and the configured thresholds. */
function moneyColor(value: number, kind: "balance" | "spend", thresholds: RequestyThresholds): string {
	return paletteForStatus(requestyMetricStatus(value, kind, thresholds)).accent;
}

function metricValue(
	money: NonNullable<UsageSnapshot["requesty"]>,
	metric: RequestyMetric,
): number | null {
	switch (metric) {
		case "balance":
			return money.balanceUsd;
		case "spend24h":
			return money.spend24hUsd;
		case "spend7d":
			return money.spend7dUsd;
	}
}

function metricCaption(metric: RequestyMetric): string {
	switch (metric) {
		case "balance":
			return "Balance";
		case "spend24h":
			return "24h spend";
		case "spend7d":
			return "7d spend";
	}
}

function providerLabel(provider: UsageSnapshot["provider"]): string {
	return provider === "requesty" ? "Requesty" : "Claude";
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
