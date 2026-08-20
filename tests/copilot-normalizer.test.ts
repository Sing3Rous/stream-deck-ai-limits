import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCopilotUsage } from "../src/providers/copilot/copilot-normalizer.ts";
import type { CopilotUsageResponse } from "../src/providers/copilot/copilot-types.ts";

// --- helpers ---------------------------------------------------------------

const RAW: CopilotUsageResponse = {
	copilot_plan: "individual_pro",
	quota_reset_date: "2026-09-01",
	quota_reset_date_utc: "2026-09-01T00:00:00Z",
	quota_snapshots: {
		premium_interactions: {
			entitlement: 7000,
			remaining: 6399,
			percent_remaining: 91.4,
			unlimited: false,
			overage_permitted: true,
			overage_entitlement: 5000,
			overage_count: 0,
			has_quota: true,
		},
		chat: { unlimited: true },
		completions: { unlimited: true },
	},
};

// --- normalizer ------------------------------------------------------------

test("premium_interactions maps to the session window", () => {
	const snap = normalizeCopilotUsage(RAW, undefined, new Date("2026-08-18T12:00:00Z"));
	assert.equal(snap.provider, "copilot");
	// used = 100 - percent_remaining (91.4 → 8.6 → round → 9)
	assert.equal(snap.session.usedPercent, 9);
	// quota_reset_date_utc is normalized to ISO
	assert.equal(snap.session.resetAt, "2026-09-01T00:00:00.000Z");
	// Copilot has no weekly window
	assert.equal(snap.weekly.usedPercent, null);
	assert.equal(snap.weekly.resetAt, null);
	assert.equal(snap.status, "ok");
	assert.equal(snap.updatedAt, "2026-08-18T12:00:00.000Z");
});

test("fallback to remaining/entitlement when percent_remaining is missing", () => {
	const raw: CopilotUsageResponse = {
		quota_snapshots: {
			premium_interactions: { entitlement: 100, remaining: 25 },
		},
	};
	const snap = normalizeCopilotUsage(raw);
	// 100 * (1 - 25/100) = 75
	assert.equal(snap.session.usedPercent, 75);
	assert.equal(snap.status, "warning"); // 75 ≥ default warning 70
});

test("full depletion → limited", () => {
	const raw: CopilotUsageResponse = {
		quota_snapshots: {
			premium_interactions: { entitlement: 100, remaining: 0, percent_remaining: 0 },
		},
	};
	const snap = normalizeCopilotUsage(raw);
	assert.equal(snap.session.usedPercent, 100);
	assert.equal(snap.status, "limited");
});

test("unlimited plan → usedPercent null, status ok", () => {
	const raw: CopilotUsageResponse = {
		quota_snapshots: {
			premium_interactions: { unlimited: true, percent_remaining: 91.4, entitlement: 7000, remaining: 6399 },
		},
	};
	const snap = normalizeCopilotUsage(raw);
	assert.equal(snap.session.usedPercent, null);
	assert.equal(snap.status, "ok");
});

test("missing quota_reset_date_utc → resetAt null", () => {
	const raw: CopilotUsageResponse = {
		quota_reset_date: "2026-09-01",
		quota_snapshots: { premium_interactions: { percent_remaining: 50 } },
	};
	const snap = normalizeCopilotUsage(raw);
	assert.equal(snap.session.usedPercent, 50);
	assert.equal(snap.session.resetAt, null);
});

test("invalid quota_reset_date_utc → resetAt null", () => {
	const raw: CopilotUsageResponse = {
		quota_reset_date_utc: "not-a-date",
		quota_snapshots: { premium_interactions: { percent_remaining: 50 } },
	};
	const snap = normalizeCopilotUsage(raw);
	assert.equal(snap.session.resetAt, null);
});

test("overage fields are ignored — only the premium quota surfaces", () => {
	const raw: CopilotUsageResponse = {
		quota_snapshots: {
			premium_interactions: {
				entitlement: 7000,
				remaining: 6399,
				percent_remaining: 91.4,
				unlimited: false,
				overage_permitted: true,
				overage_entitlement: 5000,
				overage_count: 1200,
				has_quota: true,
			},
		},
	};
	const snap = normalizeCopilotUsage(raw);
	assert.equal(snap.session.usedPercent, 9); // overage numbers did not leak into the quota
	assert.equal(snap.status, "ok");
});

test("chat/completions snapshots are not surfaced", () => {
	const raw: CopilotUsageResponse = {
		quota_snapshots: {
			chat: { unlimited: true },
			completions: { unlimited: true },
		},
	};
	const snap = normalizeCopilotUsage(raw);
	assert.equal(snap.session.usedPercent, null);
	assert.equal(snap.weekly.usedPercent, null);
	assert.equal(snap.status, "ok");
});

test("status honors custom thresholds", () => {
	const raw: CopilotUsageResponse = {
		quota_snapshots: { premium_interactions: { percent_remaining: 15 } },
	};
	const thresholds = { warning: 70, critical: 90 };
	const warning = normalizeCopilotUsage(raw, thresholds);
	assert.equal(warning.session.usedPercent, 85);
	assert.equal(warning.status, "warning");

	const critical = normalizeCopilotUsage(
		{ quota_snapshots: { premium_interactions: { percent_remaining: 5 } } },
		thresholds,
	);
	assert.equal(critical.session.usedPercent, 95);
	assert.equal(critical.status, "critical");
});

test("empty response → null windows, no throw", () => {
	const snap = normalizeCopilotUsage({});
	assert.equal(snap.session.usedPercent, null);
	assert.equal(snap.session.resetAt, null);
	assert.equal(snap.status, "ok");
});
