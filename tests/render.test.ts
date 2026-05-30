import test from "node:test";
import assert from "node:assert/strict";

import { renderUsageIcon, toDataUrl } from "../src/render/usage-icon.ts";
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

/** Extract all `fill="..."` accent-ish colors to compare visual states. */
function fills(svg: string): string[] {
	return [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]);
}

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

test("stale keeps the numbers and adds a STALE marker", () => {
	const svg = renderUsageIcon(snapshot({ status: "stale", stale: true }));
	assert.match(svg, /73%/);
	assert.match(svg, /STALE/);
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
