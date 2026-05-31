import test from "node:test";
import assert from "node:assert/strict";

import { renderSingleWindowIcon, type SingleWindowOptions } from "../src/render/single-window-icon.ts";
import type { UsageSnapshot } from "../src/providers/types.ts";

function snapshot(partial: Partial<UsageSnapshot> = {}): UsageSnapshot {
	return {
		provider: "claude",
		session: { usedPercent: 18, resetAt: "2026-05-31T14:06:00Z" },
		weekly: { usedPercent: 73, resetAt: "2026-06-03T10:00:00Z" },
		status: "ok",
		updatedAt: "2026-05-31T06:00:00.000Z",
		stale: false,
		...partial,
	};
}

const baseOpts: SingleWindowOptions = {
	window: "session",
	resetDisplay: "datetime",
	dateFormat: "day-month",
	providerAccent: "frame",
	now: new Date("2026-05-31T06:08:00Z"),
};

function opts(p: Partial<SingleWindowOptions> = {}): SingleWindowOptions {
	return { ...baseOpts, ...p };
}

test("session window: window label, percentage, bar", () => {
	const svg = renderSingleWindowIcon(snapshot(), opts({ window: "session" }));
	assert.match(svg, />5H</); // compact window label (no big top title)
	assert.match(svg, />18</); // percentage value (the % is a separate tspan)
	assert.match(svg, /<rect/); // bar present
	assert.doesNotMatch(svg, /Claude 5H/); // old combined title removed
});

test("weekly window picks the weekly percentage and label", () => {
	const svg = renderSingleWindowIcon(snapshot(), opts({ window: "weekly" }));
	assert.match(svg, />7D</);
	assert.match(svg, />73</);
	assert.doesNotMatch(svg, />18</);
});

test("provider accent 'frame' draws the brand-colored border", () => {
	const claude = renderSingleWindowIcon(snapshot({ provider: "claude" }), opts({ providerAccent: "frame" }));
	assert.match(claude, /#d97757/); // Claude orange frame
	const codex = renderSingleWindowIcon(snapshot({ provider: "codex" }), opts({ providerAccent: "frame" }));
	assert.match(codex, /#10a37f/); // Codex teal frame
});

test("provider accent 'tint' colors the background", () => {
	const codex = renderSingleWindowIcon(snapshot({ provider: "codex" }), opts({ providerAccent: "tint" }));
	assert.match(codex, /fill="#173d34"/); // teal-tinted background
});

test("tinted background uses a light track so the empty arc stays visible", () => {
	const svg = renderSingleWindowIcon(snapshot(), opts({ providerAccent: "tint" }));
	assert.match(svg, /stroke="#b9b9be"/); // light gauge track
});

test("non-tinted background keeps the dark track", () => {
	const svg = renderSingleWindowIcon(snapshot(), opts({ providerAccent: "frame" }));
	assert.match(svg, /stroke="#3a3a3c"/);
});

test("provider accent 'none' uses the neutral background and no frame", () => {
	const svg = renderSingleWindowIcon(snapshot({ provider: "claude" }), opts({ providerAccent: "none" }));
	assert.match(svg, /fill="#1c1c1e"/); // neutral background, not tinted
	assert.doesNotMatch(svg, /stroke="#d97757"/); // no brand-colored frame
});

test("datetime reset display shows the formatted date (no 'resets' prefix)", () => {
	const svg = renderSingleWindowIcon(snapshot(), opts({ resetDisplay: "datetime", dateFormat: "day-month" }));
	assert.match(svg, /\d{2}:\d{2}/); // a time is shown
	assert.doesNotMatch(svg, /resets/); // the word was dropped to save space
});

test("countdown reset display shows remaining time", () => {
	const svg = renderSingleWindowIcon(
		snapshot({ session: { usedPercent: 18, resetAt: "2026-05-31T14:06:00Z" } }),
		opts({ resetDisplay: "countdown", now: new Date("2026-05-31T06:08:00Z") }),
	);
	assert.match(svg, /in 7h 58m/);
});

test("both shows date and countdown", () => {
	const svg = renderSingleWindowIcon(snapshot(), opts({ resetDisplay: "both", dateFormat: "day-month" }));
	assert.match(svg, /May/); // the date
	assert.match(svg, /in /); // the countdown
});

test("resetDisplay 'none' shows no reset text", () => {
	const svg = renderSingleWindowIcon(snapshot(), opts({ resetDisplay: "none" }));
	assert.doesNotMatch(svg, /in \d/);
	assert.doesNotMatch(svg, /May/);
});

test("gauge layout draws an arc and the percentage", () => {
	const svg = renderSingleWindowIcon(snapshot(), opts());
	assert.match(svg, /<path d="M /); // gauge arc
	assert.match(svg, /A 46 46/); // arc radius
	assert.match(svg, />18</);
});

test("percentage colored by its own band (high → red)", () => {
	const svg = renderSingleWindowIcon(
		snapshot({ session: { usedPercent: 100, resetAt: null } }),
		opts({ window: "session", resetDisplay: "none" }),
	);
	assert.match(svg, /#ff453a/); // limited red
});

test("the percentage number is colored by its status band", () => {
	// 100% → limited red, and the number text uses that fill (not white).
	const svg = renderSingleWindowIcon(
		snapshot({ session: { usedPercent: 100, resetAt: null } }),
		opts({ resetDisplay: "none" }),
	);
	assert.match(svg, /font-weight="800" fill="#ff453a">100/);
});

test("the window label uses the provider's brand color", () => {
	const claude = renderSingleWindowIcon(snapshot({ provider: "claude" }), opts({ window: "session" }));
	assert.match(claude, /fill="#d97757">5H</);
	const codex = renderSingleWindowIcon(snapshot({ provider: "codex" }), opts({ window: "weekly" }));
	assert.match(codex, /fill="#10a37f">7D</);
});

test("auth_required renders a compact Login message", () => {
	const svg = renderSingleWindowIcon(
		snapshot({ status: "auth_required", session: { usedPercent: null, resetAt: null } }),
		opts(),
	);
	assert.match(svg, /Claude 5H/);
	assert.match(svg, /Login/);
	assert.doesNotMatch(svg, />18</);
});

test("missing percentage → No Data", () => {
	const svg = renderSingleWindowIcon(
		snapshot({ session: { usedPercent: null, resetAt: null } }),
		opts({ window: "session" }),
	);
	assert.match(svg, /No Data/);
});

test("stale shows a subtle dot but keeps the number", () => {
	const svg = renderSingleWindowIcon(snapshot({ status: "stale", stale: true }), opts());
	assert.match(svg, />18</);
	assert.match(svg, /<circle/); // the stale dot
});
