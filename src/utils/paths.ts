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
 * Resolve the credentials path to use, honoring an optional user-provided override (Property
 * Inspector, Phase 8). A `~` prefix is expanded to the home directory. Empty/whitespace
 * overrides fall back to the default.
 */
export function resolveClaudeCredentialsPath(customPath?: string): string {
	const trimmed = customPath?.trim();
	if (!trimmed) {
		return defaultClaudeCredentialsPath();
	}
	if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
		return path.join(os.homedir(), trimmed.slice(1));
	}
	return path.resolve(trimmed);
}
