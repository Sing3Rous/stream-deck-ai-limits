import os from "node:os";
import path from "node:path";

/**
 * Default location of the Claude Code OAuth credentials file, created by the official
 * `claude` login flow: `~/.claude/.credentials.json`.
 */
export function defaultClaudeCredentialsPath(): string {
	return path.join(os.homedir(), ".claude", ".credentials.json");
}

/**
 * Default location of the Codex CLI credentials file, created by the Codex ChatGPT login:
 * `~/.codex/auth.json`.
 */
export function defaultCodexCredentialsPath(): string {
	return path.join(os.homedir(), ".codex", "auth.json");
}

/**
 * Resolve a credentials path, honoring an optional user-provided override (Property Inspector).
 * A `~` prefix is expanded to the home directory; empty/whitespace overrides fall back to the
 * provided default.
 */
export function resolveCredentialsPath(defaultPath: string, customPath?: string): string {
	const trimmed = customPath?.trim();
	if (!trimmed) {
		return defaultPath;
	}
	if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
		return path.join(os.homedir(), trimmed.slice(1));
	}
	return path.resolve(trimmed);
}

/** @see resolveCredentialsPath — Claude default. */
export function resolveClaudeCredentialsPath(customPath?: string): string {
	return resolveCredentialsPath(defaultClaudeCredentialsPath(), customPath);
}

/** @see resolveCredentialsPath — Codex default. */
export function resolveCodexCredentialsPath(customPath?: string): string {
	return resolveCredentialsPath(defaultCodexCredentialsPath(), customPath);
}
