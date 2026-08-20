import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import {
	resolveUsageSettings,
	resolveSingleWindowSettings,
	DEFAULT_INTERVAL_SEC,
	MIN_INTERVAL_SEC,
	MAX_INTERVAL_SEC,
	DEFAULT_WARNING_THRESHOLD,
	DEFAULT_CRITICAL_THRESHOLD,
} from "../src/settings/usage-settings.ts";
import { isUsageError } from "../src/utils/errors.ts";
import { isNetworkOrDevicePath, resolveCredentialsPath } from "../src/utils/paths.ts";

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

test("credentials paths reject Windows network and device prefixes without exposing the path", () => {
	for (const value of ["\\\\server\\share\\creds", "\\\\?\\UNC\\server\\share\\creds", "\\\\.\\pipe\\creds"]) {
		assert.equal(isNetworkOrDevicePath(value), true);
		assert.throws(() => resolveCredentialsPath("/default", value), (err: unknown) => {
			assert.ok(isUsageError(err));
			assert.equal(err.status, "auth_required");
			assert.doesNotMatch(err.message, /server|pipe|creds/i);
			return true;
		});
	}
	assert.equal(resolveCredentialsPath("/default", "~/creds"), path.join(os.homedir(), "creds"));
	assert.equal(isNetworkOrDevicePath("C:\\Users\\me\\creds"), false);
	assert.equal(isNetworkOrDevicePath("/tmp/creds"), false);
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

test("single-window: copilot always resolves to the session window", () => {
	const r = resolveSingleWindowSettings({ provider: "copilot", window: "weekly" });
	assert.equal(r.provider, "copilot");
	assert.equal(r.window, "session");
});

test("single-window: copilot is accepted from the provider picker", () => {
	const r = resolveSingleWindowSettings({ provider: "copilot" });
	assert.equal(r.provider, "copilot");
	assert.equal(r.window, "session");
});
