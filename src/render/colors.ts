import type { UsageStatus } from "../providers/types.ts";

/**
 * Palette for the usage key, keyed by status. Kept separate from the renderer so the visual
 * theme can be tweaked in one place without touching layout logic.
 */
export interface Palette {
	/** Key background. */
	background: string;
	/** Primary text (labels, percentages). */
	text: string;
	/** Dimmed text (secondary labels, e.g. STALE marker). */
	textMuted: string;
	/** Empty portion of a progress bar / track. */
	track: string;
	/** Filled portion of a progress bar — the accent for the current status. */
	accent: string;
}

const TEXT = "#f2f2f7";
const TEXT_MUTED = "#8e8e93";
const TRACK = "#3a3a3c";

/** Status → accent (fill) color. */
const ACCENT: Record<UsageStatus, string> = {
	ok: "#34c759", // green
	warning: "#ffd60a", // yellow
	critical: "#ff9f0a", // orange
	limited: "#ff453a", // red
	stale: "#636366", // muted gray (data shown but dimmed)
	auth_required: "#636366", // neutral gray
	rate_limited: "#ff9f0a", // orange (a softer alarm than hard error)
	error: "#ff453a", // red
};

const BACKGROUND: Record<UsageStatus, string> = {
	ok: "#1c1c1e",
	warning: "#1c1c1e",
	critical: "#1c1c1e",
	limited: "#1c1c1e",
	stale: "#141414", // slightly darker to read as "dimmed"
	auth_required: "#1c1c1e",
	rate_limited: "#1c1c1e",
	error: "#1c1c1e",
};

export function paletteForStatus(status: UsageStatus): Palette {
	return {
		background: BACKGROUND[status],
		text: status === "stale" ? TEXT_MUTED : TEXT,
		textMuted: TEXT_MUTED,
		track: TRACK,
		accent: ACCENT[status],
	};
}
