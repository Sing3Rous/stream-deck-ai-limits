import test from "node:test";
import assert from "node:assert/strict";

import { fetchClaudeUsage, UnauthorizedError } from "../src/providers/claude/claude-api-client.ts";
import { isUsageError } from "../src/utils/errors.ts";

type FetchArgs = { url: string; init: RequestInit };

/** Replace global fetch with a stub for the duration of `run`, capturing the call args. */
async function withFetch(
	impl: (args: FetchArgs) => Promise<Response> | Response,
	run: (captured: FetchArgs[]) => Promise<void>,
): Promise<void> {
	const original = globalThis.fetch;
	const captured: FetchArgs[] = [];
	globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
		const args = { url: String(url), init: init ?? {} };
		captured.push(args);
		return impl(args);
	}) as typeof fetch;
	try {
		await run(captured);
	} finally {
		globalThis.fetch = original;
	}
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("200 returns the parsed raw usage response", async () => {
	const raw = { five_hour: { utilization: 86, resets_at: "2026-05-30T15:00:00Z" }, seven_day: { utilization: 51, resets_at: "2026-06-02T00:00:00Z" } };
	await withFetch(() => jsonResponse(200, raw), async () => {
		const result = await fetchClaudeUsage("FAKE_TOKEN");
		assert.equal(result.five_hour?.utilization, 86);
		assert.equal(result.seven_day?.resets_at, "2026-06-02T00:00:00Z");
	});
});

test("sends correct endpoint, Authorization and beta headers", async () => {
	await withFetch(() => jsonResponse(200, {}), async (captured) => {
		await fetchClaudeUsage("FAKE_TOKEN_123");
		const { url, init } = captured[0];
		assert.equal(url, "https://api.anthropic.com/api/oauth/usage");
		const headers = init.headers as Record<string, string>;
		assert.equal(headers.Authorization, "Bearer FAKE_TOKEN_123");
		assert.equal(headers["anthropic-version"], "2023-06-01");
		assert.equal(headers["anthropic-beta"], "oauth-2025-04-20");
	});
});

test("401 throws UnauthorizedError (so caller can refresh + retry)", async () => {
	await withFetch(() => jsonResponse(401, { error: "unauthorized" }), async () => {
		await assert.rejects(() => fetchClaudeUsage("FAKE"), (err: unknown) => err instanceof UnauthorizedError);
	});
});

test("429 maps to rate_limited", async () => {
	await withFetch(() => jsonResponse(429, { error: "rate_limited" }), async () => {
		await assert.rejects(
			() => fetchClaudeUsage("FAKE"),
			(err: unknown) => isUsageError(err) && err.status === "rate_limited",
		);
	});
});

test("429 parses Retry-After (seconds) into retryAfterMs", async () => {
	const resWithRetry = () => new Response("{}", { status: 429, headers: { "Retry-After": "72" } });
	await withFetch(resWithRetry, async () => {
		await assert.rejects(
			() => fetchClaudeUsage("FAKE"),
			(err: unknown) => isUsageError(err) && err.status === "rate_limited" && err.retryAfterMs === 72_000,
		);
	});
});

test("403 maps to auth_required", async () => {
	await withFetch(() => jsonResponse(403, {}), async () => {
		await assert.rejects(
			() => fetchClaudeUsage("FAKE"),
			(err: unknown) => isUsageError(err) && err.status === "auth_required",
		);
	});
});

test("500 maps to error", async () => {
	await withFetch(() => jsonResponse(500, {}), async () => {
		await assert.rejects(
			() => fetchClaudeUsage("FAKE"),
			(err: unknown) => isUsageError(err) && err.status === "error",
		);
	});
});

test("network failure maps to error", async () => {
	await withFetch(() => { throw new TypeError("fetch failed"); }, async () => {
		await assert.rejects(
			() => fetchClaudeUsage("FAKE"),
			(err: unknown) => isUsageError(err) && err.status === "error",
		);
	});
});

test("abort/timeout maps to error", async () => {
	await withFetch(() => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }, async () => {
		await assert.rejects(
			() => fetchClaudeUsage("FAKE"),
			(err: unknown) => isUsageError(err) && err.status === "error" && /timed out/i.test(err.message),
		);
	});
});

test("200 with invalid JSON maps to error", async () => {
	await withFetch(() => new Response("not json", { status: 200 }), async () => {
		await assert.rejects(
			() => fetchClaudeUsage("FAKE"),
			(err: unknown) => isUsageError(err) && err.status === "error",
		);
	});
});
