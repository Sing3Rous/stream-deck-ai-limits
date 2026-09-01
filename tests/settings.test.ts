import test from "node:test";
import assert from "node:assert/strict";

import {
	resolveUsageSettings,
	sameResolvedSettings,
	resolveRequestySettings,
	sameRequestySettings,
	DEFAULT_INTERVAL_SEC,
	MIN_INTERVAL_SEC,
	MAX_INTERVAL_SEC,
	DEFAULT_WARNING_THRESHOLD,
	DEFAULT_CRITICAL_THRESHOLD,
} from "../src/settings/usage-settings.ts";
import { DEFAULT_REQUESTY_THRESHOLDS } from "../src/providers/types.ts";

test("empty settings → all defaults", () => {
	const r = resolveUsageSettings();
	assert.equal(r.intervalSec, DEFAULT_INTERVAL_SEC);
	assert.equal(r.thresholds.warning, DEFAULT_WARNING_THRESHOLD);
	assert.equal(r.thresholds.critical, DEFAULT_CRITICAL_THRESHOLD);
	assert.equal(r.customCredentialsPath, undefined);
});

test("interval is clamped to [MIN, MAX] and rounded", () => {
	assert.equal(resolveUsageSettings({ refreshIntervalSec: 5 }).intervalSec, MIN_INTERVAL_SEC);
	assert.equal(resolveUsageSettings({ refreshIntervalSec: 30 }).intervalSec, MIN_INTERVAL_SEC); // below floor
	assert.equal(resolveUsageSettings({ refreshIntervalSec: 99999 }).intervalSec, MAX_INTERVAL_SEC);
	assert.equal(resolveUsageSettings({ refreshIntervalSec: 122.7 }).intervalSec, 123);
	assert.equal(resolveUsageSettings({ refreshIntervalSec: 90 }).intervalSec, 90);
});

test("invalid interval → default", () => {
	assert.equal(resolveUsageSettings({ refreshIntervalSec: Number.NaN }).intervalSec, DEFAULT_INTERVAL_SEC);
	assert.equal(
		resolveUsageSettings({ refreshIntervalSec: "abc" as unknown as number }).intervalSec,
		DEFAULT_INTERVAL_SEC,
	);
});

test("thresholds clamped to 0..100 and rounded", () => {
	const r = resolveUsageSettings({ warningThreshold: -10, criticalThreshold: 250 });
	assert.equal(r.thresholds.warning, 0);
	assert.equal(r.thresholds.critical, 100);
});

test("critical is forced to be >= warning", () => {
	const r = resolveUsageSettings({ warningThreshold: 80, criticalThreshold: 50 });
	assert.equal(r.thresholds.warning, 80);
	assert.equal(r.thresholds.critical, 80);
});

test("custom credentials path is trimmed; blank → undefined", () => {
	assert.equal(resolveUsageSettings({ customCredentialsPath: "  /tmp/creds.json  " }).customCredentialsPath, "/tmp/creds.json");
	assert.equal(resolveUsageSettings({ customCredentialsPath: "   " }).customCredentialsPath, undefined);
	assert.equal(resolveUsageSettings({ customCredentialsPath: "" }).customCredentialsPath, undefined);
});

test("valid full settings pass through", () => {
	const r = resolveUsageSettings({
		refreshIntervalSec: 90,
		warningThreshold: 60,
		criticalThreshold: 85,
		customCredentialsPath: "/home/u/.claude/.credentials.json",
	});
	assert.equal(r.intervalSec, 90);
	assert.equal(r.thresholds.warning, 60);
	assert.equal(r.thresholds.critical, 85);
	assert.equal(r.customCredentialsPath, "/home/u/.claude/.credentials.json");
});

// --- Requesty settings ------------------------------------------------------

test("resolveRequestySettings: empty settings → defaults", () => {
	const r = resolveRequestySettings();
	assert.deepEqual(r.requestyThresholds, DEFAULT_REQUESTY_THRESHOLDS);
	assert.equal(r.requestyMetric, "balance");
});

test("resolveRequestySettings: valid values pass through", () => {
	const r = resolveRequestySettings({
		requestyMetric: "spend7d",
		balanceWarningUsd: 8,
		balanceCriticalUsd: 3,
		spendWarningUsd: 2.5,
		spendCriticalUsd: 7.25,
	});
	assert.deepEqual(r.requestyThresholds, { balanceWarningUsd: 8, balanceCriticalUsd: 3, spendWarningUsd: 2.5, spendCriticalUsd: 7.25 });
	assert.equal(r.requestyMetric, "spend7d");
});

test("resolveRequestySettings: numeric strings from the PI coerce", () => {
	const r = resolveRequestySettings({ balanceWarningUsd: "6.5", balanceCriticalUsd: "2", spendWarningUsd: "3.75", spendCriticalUsd: "9" });
	assert.deepEqual(r.requestyThresholds, { balanceWarningUsd: 6.5, balanceCriticalUsd: 2, spendWarningUsd: 3.75, spendCriticalUsd: 9 });
});

test("resolveRequestySettings: invalid values fall back to defaults", () => {
	const r = resolveRequestySettings({
		balanceWarningUsd: Number.NaN,
		balanceCriticalUsd: "abc",
		spendWarningUsd: Number.POSITIVE_INFINITY,
		spendCriticalUsd: undefined,
	});
	assert.deepEqual(r.requestyThresholds, DEFAULT_REQUESTY_THRESHOLDS);
});

test("resolveRequestySettings: negative amounts clamp to zero", () => {
	const r = resolveRequestySettings({ balanceWarningUsd: -4, balanceCriticalUsd: 1.5, spendWarningUsd: 3, spendCriticalUsd: -2 });
	assert.equal(r.requestyThresholds.balanceWarningUsd, 0);
	assert.equal(r.requestyThresholds.balanceCriticalUsd, 0, "balance critical clamped down to warning (0)");
	assert.equal(r.requestyThresholds.spendWarningUsd, 3);
	assert.equal(r.requestyThresholds.spendCriticalUsd, 3, "spend critical clamped up to warning");
});

test("resolveRequestySettings: balance warning >= critical enforced (critical clamped down)", () => {
	const r = resolveRequestySettings({ balanceWarningUsd: 3, balanceCriticalUsd: 5 });
	assert.equal(r.requestyThresholds.balanceWarningUsd, 3);
	assert.equal(r.requestyThresholds.balanceCriticalUsd, 3, "balance critical clamped down to warning");
});

test("resolveRequestySettings: spend critical >= warning enforced (critical clamped up)", () => {
	const r = resolveRequestySettings({ spendWarningUsd: 8, spendCriticalUsd: 4 });
	assert.equal(r.requestyThresholds.spendWarningUsd, 8);
	assert.equal(r.requestyThresholds.spendCriticalUsd, 8, "spend critical clamped up to warning");
});

test("resolveRequestySettings: invalid metric falls back to balance", () => {
	assert.equal(resolveRequestySettings({ requestyMetric: "nope" }).requestyMetric, "balance");
});

test("sameRequestySettings: true for equal, false for any difference", () => {
	const a = resolveRequestySettings({ requestyMetric: "balance", balanceWarningUsd: 5, balanceCriticalUsd: 2, spendWarningUsd: 2, spendCriticalUsd: 5 });
	const b = resolveRequestySettings({ requestyMetric: "balance", balanceWarningUsd: 5, balanceCriticalUsd: 2, spendWarningUsd: 2, spendCriticalUsd: 5 });
	assert.equal(sameRequestySettings(a, b), true);
	assert.equal(sameRequestySettings(a, resolveRequestySettings({ requestyMetric: "spend24h" })), false, "metric differs");
	assert.equal(sameRequestySettings(a, resolveRequestySettings({ balanceWarningUsd: 9 })), false, "threshold differs");
});

test("sameResolvedSettings: requesty thresholds participate in rebuild decisions", () => {
	const base = { refreshIntervalSec: 120, warningThreshold: 70, criticalThreshold: 90, customCredentialsPath: "/x" };
	assert.equal(sameResolvedSettings(resolveUsageSettings(base), resolveUsageSettings(base)), true);
	assert.equal(
		sameResolvedSettings(resolveUsageSettings(base), resolveUsageSettings({ ...base, balanceWarningUsd: 10 })),
		false,
		"requesty threshold change must trigger a rebuild",
	);
	assert.equal(
		sameResolvedSettings(resolveUsageSettings(base), resolveUsageSettings({ ...base, requestyMetric: "spend7d" })),
		true,
		"display-only metric change must NOT rebuild the provider",
	);
});
