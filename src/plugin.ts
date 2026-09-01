import streamDeck from "@elgato/streamdeck";

import { ClaudeUsageAction } from "./actions/claude-usage-action.ts";
import { CodexUsageAction } from "./actions/codex-usage-action.ts";
import { RequestySingleAction } from "./actions/requesty-single-action.ts";
import { RequestyUsageAction } from "./actions/requesty-usage-action.ts";
import { SingleWindowAction } from "./actions/single-window-action.ts";

// INFO level avoids logging the full Stream Deck message traffic. This plugin handles OAuth
// tokens, so trace-level logging (which records all messages) must never be enabled.
streamDeck.logger.setLevel("info");

// Register the usage actions.
streamDeck.actions.registerAction(new ClaudeUsageAction());
streamDeck.actions.registerAction(new CodexUsageAction());
streamDeck.actions.registerAction(new SingleWindowAction());
streamDeck.actions.registerAction(new RequestyUsageAction());
streamDeck.actions.registerAction(new RequestySingleAction());

// Finally, connect to the Stream Deck.
streamDeck.connect();
