import streamDeck from "@elgato/streamdeck";

// INFO level avoids logging the full Stream Deck message traffic. This plugin handles OAuth
// tokens, so trace-level logging (which records all messages) must never be enabled.
streamDeck.logger.setLevel("info");

// Actions are registered in Phase 1+ (ClaudeUsageAction). For now we just connect so the
// scaffold keeps building and the plugin loads without the removed sample action.
streamDeck.connect();
