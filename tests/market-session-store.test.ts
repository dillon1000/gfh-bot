import { describe, expect, it, vi } from "vitest";

import { claimMarketInteractionSession } from "@/features/markets/state/interaction-session-store.js";
import { claimMarketTradeQuoteSession } from "@/features/markets/state/quote-session-store.js";

describe("market session claims", () => {
	it("claims a quote with one atomic Redis operation", async () => {
		const session = {
			kind: "trade",
			sessionId: "quote_1",
			userId: "user_1",
		};
		const redis = {
			eval: vi.fn().mockResolvedValue(JSON.stringify(session)),
		};

		await expect(
			claimMarketTradeQuoteSession(redis as never, "quote_1", "user_1"),
		).resolves.toEqual(session);
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
				.mockResolvedValueOnce(
					JSON.stringify({
						kind: "trade",
						sessionId: "quote_1",
						userId: "user_1",
					}),
				)
				.mockResolvedValueOnce(null),
		};

		await expect(
			claimMarketTradeQuoteSession(redis as never, "quote_1", "user_1"),
		).resolves.toBeTruthy();
		await expect(
			claimMarketTradeQuoteSession(redis as never, "quote_1", "user_1"),
		).resolves.toBeNull();
	});
});
