import test from "node:test";
import assert from "node:assert/strict";

import { renderUsageIcon, toDataUrl } from "../src/render/usage-icon.ts";
import { renderRequestySingleIcon } from "../src/render/requesty-single-icon.ts";
import type { UsageSnapshot, UsageStatus } from "../src/providers/types.ts";

function snapshot(partial: Partial<UsageSnapshot> = {}): UsageSnapshot {
	return {
		provider: "claude",
		session: { usedPercent: 73, resetAt: null },
		weekly: { usedPercent: 44, resetAt: null },
		status: "warning",
		updatedAt: "2026-05-30T00:00:00.000Z",
		stale: false,
		...partial,
	};
}

/** A requesty snapshot with money data (percentage windows always null). */
function requestySnapshot(partial: Partial<UsageSnapshot> = {}): UsageSnapshot {
	return snapshot({
		provider: "requesty",
		status: "ok",
		session: { usedPercent: null, resetAt: null },
		weekly: { usedPercent: null, resetAt: null },
		requesty: {
			balanceUsd: 12.345,
			spend24hUsd: 0.5,
			spend7dUsd: null,
			thresholds: { balanceWarningUsd: 5, balanceCriticalUsd: 2, spendWarningUsd: 2, spendCriticalUsd: 5 },
		},
		...partial,
	});
}

/** Extract all `fill="..."` accent-ish colors to compare visual states. */
function fills(svg: string): string[] {
	return [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]);
}

const GREEN = "#34c759"; // ok
const RED = "#ff453a"; // limited

test("bars layout: shows both window percentages", () => {
	const svg = renderUsageIcon(snapshot({ session: { usedPercent: 73, resetAt: null }, weekly: { usedPercent: 44, resetAt: null } }));
	assert.match(svg, /<svg[\s\S]*<\/svg>/);
	assert.match(svg, /73%/);
	assert.match(svg, /44%/);
	assert.match(svg, />5H</);
	assert.match(svg, />W</);
});

test("percentages are rounded to integers", () => {
	const svg = renderUsageIcon(snapshot({ session: { usedPercent: 72.6, resetAt: null }, weekly: { usedPercent: 44.2, resetAt: null } }));
	assert.match(svg, /73%/);
	assert.match(svg, /44%/);
});

test("status bands produce distinct accent colors", () => {
	const colors = new Set<string>();
	for (const [pct, status] of [[10, "ok"], [75, "warning"], [95, "critical"], [100, "limited"]] as const) {
		const svg = renderUsageIcon(snapshot({ session: { usedPercent: pct, resetAt: null }, weekly: { usedPercent: 0, resetAt: null }, status: status as UsageStatus }));
		// the filled bar uses the accent; collect the non-background, non-track fills
		fills(svg).forEach((c) => colors.add(c));
	}
	// ok/warning/critical/limited accents differ → at least 4 distinct accent colors present
	assert.ok(colors.size >= 4, `expected >=4 distinct colors, got ${colors.size}: ${[...colors].join(",")}`);
});

test("each bar is colored by its OWN percentage (not the worst overall)", () => {
	// session low (ok→green), weekly maxed (limited→red). Both colors must appear.
	const svg = renderUsageIcon(
		snapshot({
			session: { usedPercent: 5, resetAt: null },
			weekly: { usedPercent: 100, resetAt: null },
			status: "limited", // overall worst
		}),
	);
	const present = fills(svg);
	assert.ok(present.includes(GREEN), `expected a green (ok) bar for 5%, got: ${present.join(",")}`);
	assert.ok(present.includes(RED), `expected a red (limited) bar for 100%, got: ${present.join(",")}`);
});

test("per-bar colors respect custom thresholds carried on the snapshot", () => {
	// With warning=10/critical=20, a 15% bar should be warning (yellow), a 5% bar ok (green).
	const svg = renderUsageIcon(
		snapshot({
			session: { usedPercent: 5, resetAt: null },
			weekly: { usedPercent: 15, resetAt: null },
			status: "warning",
			thresholds: { warning: 10, critical: 20 },
		}),
	);
	const present = fills(svg);
	assert.ok(present.includes(GREEN), "5% under custom warning=10 → green");
	assert.ok(present.includes("#ffd60a"), "15% at custom warning=10 → yellow");
});

test("stale shows real per-bar colors (not dimmed) with only a subtle dot", () => {
	const svg = renderUsageIcon(
		snapshot({
			session: { usedPercent: 5, resetAt: null },
			weekly: { usedPercent: 100, resetAt: null },
			status: "stale",
			stale: true,
			staleReason: "rate_limited",
		}),
	);
	// Numbers stay, colored by their own percentage — looks like live data.
	assert.match(svg, /5%/);
	assert.match(svg, /100%/);
	assert.ok(fills(svg).includes(GREEN), "5% bar still green when stale");
	assert.ok(fills(svg).includes(RED), "100% bar still red when stale");
	// A small dot hints staleness; no big alarming text.
	assert.match(svg, /<circle/);
	assert.doesNotMatch(svg, /RATE LIM/);
	assert.doesNotMatch(svg, /STALE/);
});

test("auth_required renders a Login Required message, not bars", () => {
	const svg = renderUsageIcon(snapshot({ status: "auth_required", session: { usedPercent: null, resetAt: null }, weekly: { usedPercent: null, resetAt: null } }));
	assert.match(svg, /Login/);
	assert.match(svg, /Required/);
	assert.doesNotMatch(svg, /5H/);
});

test("rate_limited renders a Rate Limited message", () => {
	const svg = renderUsageIcon(snapshot({ status: "rate_limited", session: { usedPercent: null, resetAt: null }, weekly: { usedPercent: null, resetAt: null } }));
	assert.match(svg, /Rate/);
	assert.match(svg, /Limited/);
});

test("error renders an Error message", () => {
	const svg = renderUsageIcon(snapshot({ status: "error", session: { usedPercent: null, resetAt: null }, weekly: { usedPercent: null, resetAt: null } }));
	assert.match(svg, /Error/);
});

test("stale keeps the numbers and adds only a subtle dot", () => {
	const svg = renderUsageIcon(snapshot({ status: "stale", stale: true }));
	assert.match(svg, /73%/);
	assert.match(svg, /<circle/);
	assert.doesNotMatch(svg, /STALE/);
});

test("missing values render an em dash instead of a percentage", () => {
	const svg = renderUsageIcon(snapshot({ status: "ok", session: { usedPercent: 50, resetAt: null }, weekly: { usedPercent: null, resetAt: null } }));
	assert.match(svg, /50%/);
	assert.match(svg, /—/);
});

test("both windows null (non-error status) falls back to a No Data message", () => {
	const svg = renderUsageIcon(snapshot({ status: "ok", session: { usedPercent: null, resetAt: null }, weekly: { usedPercent: null, resetAt: null } }));
	assert.match(svg, /No/);
	assert.match(svg, /Data/);
});

test("toDataUrl produces a base64 svg data URL that round-trips", () => {
	const svg = renderUsageIcon(snapshot());
	const url = toDataUrl(svg);
	assert.match(url, /^data:image\/svg\+xml;base64,/);
	const decoded = Buffer.from(url.split(",")[1], "base64").toString("utf-8");
	assert.equal(decoded, svg);
});

test("provider label: codex auth_required shows 'Codex', not 'Claude'", () => {
	const svg = renderUsageIcon(
		snapshot({
			provider: "codex",
			status: "auth_required",
			session: { usedPercent: null, resetAt: null },
			weekly: { usedPercent: null, resetAt: null },
		}),
	);
	assert.match(svg, /Codex/);
	assert.doesNotMatch(svg, /Claude/);
});

test("provider label: claude error shows 'Claude'", () => {
	const svg = renderUsageIcon(
		snapshot({
			provider: "claude",
			status: "error",
			session: { usedPercent: null, resetAt: null },
			weekly: { usedPercent: null, resetAt: null },
		}),
	);
	assert.match(svg, /Claude/);
});

// --- Requesty layouts -------------------------------------------------------

test("requesty combined layout: BAL/24H/7D rows with $ values", () => {
	const svg = renderUsageIcon(requestySnapshot());
	assert.match(svg, />BAL</);
	assert.match(svg, />24H</);
	assert.match(svg, />7D</);
	assert.match(svg, /\$12\.35/, "balance rounded to 2 decimals");
	assert.match(svg, /\$0\.50/, "spend 24h rounded to 2 decimals");
	assert.match(svg, /—/, "null 7d value renders an em dash");
	assert.doesNotMatch(svg, /5H/, "no percentage bars for requesty");
	assert.doesNotMatch(svg, /No\s*Data/);
});

test("requesty combined layout: each row colored by its own metric status", () => {
	const svg = renderUsageIcon(
		requestySnapshot({
			requesty: {
				balanceUsd: 1, // ≤ critical(2) → critical
				spend24hUsd: 3, // ≥ warning(2) → warning
				spend7dUsd: 10, // ≥ critical(5) → critical
				thresholds: { balanceWarningUsd: 5, balanceCriticalUsd: 2, spendWarningUsd: 2, spendCriticalUsd: 5 },
			},
		}),
	);
	const present = fills(svg);
	assert.ok(present.includes("#ff9f0a"), `expected critical accent present, got: ${present.join(",")}`);
	assert.ok(present.includes("#ffd60a"), `expected warning accent present, got: ${present.join(",")}`);
});

test("requesty combined layout: error status still renders the fallback message", () => {
	const svg = renderUsageIcon(
		requestySnapshot({
			status: "error",
			session: { usedPercent: null, resetAt: null },
			weekly: { usedPercent: null, resetAt: null },
			requesty: undefined,
		}),
	);
	assert.match(svg, /Error/);
	assert.match(svg, /Requesty/);
	assert.doesNotMatch(svg, />BAL</);
});

test("requesty single layout: balance shows big $ value + caption", () => {
	const svg = renderRequestySingleIcon(
		requestySnapshot({ requesty: { balanceUsd: 12.345, spend24hUsd: null, spend7dUsd: null, thresholds: undefined } }),
		"balance",
	);
	assert.match(svg, /\$12\.35/);
	assert.match(svg, /Balance/);
	assert.match(svg, /Requesty/);
});

test("requesty single layout: 24h spend caption with dash for null value", () => {
	const svg = renderRequestySingleIcon(
		requestySnapshot({ requesty: { balanceUsd: null, spend24hUsd: null, spend7dUsd: null, thresholds: undefined } }),
		"spend24h",
	);
	assert.match(svg, /24h spend/);
	assert.match(svg, /—/);
});

test("requesty single layout: 7d spend caption", () => {
	const svg = renderRequestySingleIcon(
		requestySnapshot({ requesty: { balanceUsd: null, spend24hUsd: null, spend7dUsd: 8.4, thresholds: undefined } }),
		"spend7d",
	);
	assert.match(svg, /\$8\.40/);
	assert.match(svg, /7d spend/);
});

test("requesty single layout: value colored by metric status", () => {
	const svg = renderRequestySingleIcon(
		requestySnapshot({ requesty: { balanceUsd: 1, spend24hUsd: null, spend7dUsd: null, thresholds: { balanceWarningUsd: 5, balanceCriticalUsd: 2, spendWarningUsd: 2, spendCriticalUsd: 5 } } }),
		"balance",
	);
	assert.ok(fills(svg).includes("#ff9f0a"), `expected critical accent, got: ${fills(svg).join(",")}`);
});

test("requesty single layout: error status renders the fallback message", () => {
	const svg = renderRequestySingleIcon(
		requestySnapshot({ status: "error", session: { usedPercent: null, resetAt: null }, weekly: { usedPercent: null, resetAt: null }, requesty: undefined }),
		"balance",
	);
	assert.match(svg, /Error/);
	assert.match(svg, /Requesty/);
	assert.doesNotMatch(svg, /\$12\.35/);
});
