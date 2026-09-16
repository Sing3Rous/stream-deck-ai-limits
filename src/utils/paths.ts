import os from "node:os";
import path from "node:path";

import { authRequired } from "./errors.ts";

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
	// Do not hand network or device paths to fs APIs: on Windows those can trigger outbound
	// integrated authentication. Plain local drive paths (C:\...), POSIX paths, and
	// home-relative paths remain supported on every platform; note that extended-length
	// local paths (\\?\C:\...) start with "\\" and are therefore rejected here too.
	if (isNetworkOrDevicePath(trimmed)) {
		throw authRequired("Network and device credentials paths are not supported.");
	}
	if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
		return path.join(os.homedir(), trimmed.slice(1));
	}
	return path.resolve(trimmed);
}

/** Whether a path uses a Windows UNC/network or device namespace prefix. */
export function isNetworkOrDevicePath(value: string): boolean {
	return value.startsWith("\\\\") || value.startsWith("//") || /^\\(?:\?\?\\|Device\\)/i.test(value);
}

/** @see resolveCredentialsPath — Claude default. */
export function resolveClaudeCredentialsPath(customPath?: string): string {
	return resolveCredentialsPath(defaultClaudeCredentialsPath(), customPath);
}

/** @see resolveCredentialsPath — Codex default. */
export function resolveCodexCredentialsPath(customPath?: string): string {
	return resolveCredentialsPath(defaultCodexCredentialsPath(), customPath);
}
