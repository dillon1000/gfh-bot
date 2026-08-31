import { describe, expect, it, vi } from "vitest";

import { claimMarketInteractionSession } from "@/features/markets/state/interaction-session-store.js";
import { claimMarketTradeQuoteSession } from "@/features/markets/state/quote-session-store.js";

describe("market session claims", () => {
	const quoteSession = {
		kind: "trade",
		sessionId: "quote_1",
		userId: "user_1",
		guildId: "guild_1",
		marketId: "market_1",
		marketTitle: "Ship it?",
		outcomeId: "outcome_1",
		outcomeLabel: "Yes",
		action: "buy",
		amount: 10,
		amountMode: "points",
		expiresAt: "2099-01-01T00:00:00.000Z",
	};

	it("claims a quote with one atomic Redis operation", async () => {
		const redis = {
			eval: vi.fn().mockResolvedValue(JSON.stringify(quoteSession)),
		};

		await expect(
			claimMarketTradeQuoteSession(redis as never, "quote_1", "user_1"),
		).resolves.toEqual(quoteSession);
		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining('redis.call("DEL", KEYS[1])'),
			1,
			"market-quote-session:quote_1",
			"user_1",
			expect.any(String),
		);
	});

	it("does not claim another user's interaction session", async () => {
		const redis = {
			eval: vi
				.fn()
				.mockResolvedValue("__market_interaction_wrong_user__"),
		};

		await expect(
			claimMarketInteractionSession(redis as never, "session_1", "user_2"),
		).rejects.toThrow("That session belongs to a different user.");
	});

	it("returns null after another confirmation claims the session", async () => {
		const redis = {
			eval: vi
				.fn()
				.mockResolvedValueOnce(JSON.stringify(quoteSession))
				.mockResolvedValueOnce(null),
		};

		await expect(
			claimMarketTradeQuoteSession(redis as never, "quote_1", "user_1"),
		).resolves.toBeTruthy();
		await expect(
			claimMarketTradeQuoteSession(redis as never, "quote_1", "user_1"),
		).resolves.toBeNull();
	});

	it("rejects malformed claimed session data", async () => {
		const redis = {
			eval: vi.fn().mockResolvedValue('{"kind":"trade","userId":"user_1"}'),
		};

		await expect(
			claimMarketTradeQuoteSession(redis as never, "quote_1", "user_1"),
		).rejects.toThrow();
	});
});
