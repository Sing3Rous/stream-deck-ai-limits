import test from "node:test";
import assert from "node:assert/strict";

import { fetchCopilotUsage, UnauthorizedError } from "../src/providers/copilot/copilot-api-client.ts";
import { isUsageError } from "../src/utils/errors.ts";

async function withFetch(impl: () => Promise<Response> | Response, run: (calls: Array<{ url: string; init: RequestInit }>) => Promise<void>): Promise<void> {
	const original = globalThis.fetch;
	const calls: Array<{ url: string; init: RequestInit }> = [];
	globalThis.fetch = (async (url, init) => {
		calls.push({ url: String(url), init: init ?? {} });
		return impl();
	}) as typeof fetch;
	try { await run(calls); } finally { globalThis.fetch = original; }
}

function response(status: number, body: unknown, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), { status, headers });
}

test("Copilot API sends the endpoint and bearer token", async () => {
	await withFetch(() => response(200, { quota_snapshots: {} }), async (calls) => {
		await fetchCopilotUsage("FAKE_TOKEN");
		assert.equal(calls[0].url, "https://api.github.com/copilot_internal/user");
		assert.deepEqual(calls[0].init.headers, { Authorization: "Bearer FAKE_TOKEN", Accept: "application/json" });
	});
});

test("Copilot API maps 401, 403, and 429 with Retry-After", async () => {
	await withFetch(() => response(401, {}), async () => assert.rejects(() => fetchCopilotUsage("FAKE"), UnauthorizedError));
	await withFetch(() => response(403, {}), async () => assert.rejects(() => fetchCopilotUsage("FAKE"), (err: unknown) => isUsageError(err) && err.status === "auth_required"));
	await withFetch(() => response(429, {}, { "Retry-After": "72" }), async () => assert.rejects(() => fetchCopilotUsage("FAKE"), (err: unknown) => isUsageError(err) && err.status === "rate_limited" && err.retryAfterMs === 72_000));
});

test("Copilot API maps network, timeout, and invalid JSON failures without leaking tokens", async () => {
	await withFetch(() => { throw new TypeError("network"); }, async () => assert.rejects(() => fetchCopilotUsage("SECRET_CANARY"), (err: unknown) => isUsageError(err) && err.status === "error" && !err.message.includes("SECRET_CANARY")));
	await withFetch(() => { const err = new Error("abort"); err.name = "AbortError"; throw err; }, async () => assert.rejects(() => fetchCopilotUsage("FAKE"), (err: unknown) => isUsageError(err) && /timed out/i.test(err.message)));
	await withFetch(() => new Response("not json", { status: 200 }), async () => assert.rejects(() => fetchCopilotUsage("FAKE"), (err: unknown) => isUsageError(err) && err.status === "error"));
});
