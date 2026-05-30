import streamDeck from "@elgato/streamdeck";

import { ClaudeUsageAction } from "./actions/claude-usage-action.ts";
import { CodexUsageAction } from "./actions/codex-usage-action.ts";

// INFO level avoids logging the full Stream Deck message traffic. This plugin handles OAuth
// tokens, so trace-level logging (which records all messages) must never be enabled.
streamDeck.logger.setLevel("info");

// Register the usage actions.
streamDeck.actions.registerAction(new ClaudeUsageAction());
streamDeck.actions.registerAction(new CodexUsageAction());

// Finally, connect to the Stream Deck.
streamDeck.connect();
