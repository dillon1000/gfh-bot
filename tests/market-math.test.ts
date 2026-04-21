import { describe, expect, it } from "vitest";

import {
	computeBuyCost,
	computeLmsrCost,
	computeLmsrProbabilities,
	computeSellPayout,
	computeTopKBuyCost,
	computeTopKMarginals,
	computeTopKSellPayout,
	solveBuySharesForAmount,
	solveSellSharesForAmount,
	solveShortSharesForAmount,
	solveTopKBuySharesForAmount,
	solveTopKShortSharesForAmount,
} from "../src/features/markets/core/math.js";
import { getMarketProbabilities } from "../src/features/markets/core/shared.js";

describe("market math", () => {
	it("keeps probabilities normalized", () => {
		const probabilities = computeLmsrProbabilities([12.5, 4.2, 8.1], 150);
		const total = probabilities.reduce((sum, value) => sum + value, 0);

		expect(total).toBeCloseTo(1, 10);
		expect(probabilities.every((value) => value > 0)).toBe(true);
	});

	it("keeps categorical single-winner probabilities summing to 1", () => {
		const probabilities = getMarketProbabilities({
			contractMode: "categorical_single_winner",
			winnerCount: 1,
			resolvedAt: null,
			liquidityParameter: 150,
			winningOutcomeId: null,
			outcomes: [
				{ id: "a", pricingShares: 5, settlementValue: null },
				{ id: "b", pricingShares: -1, settlementValue: null },
				{ id: "c", pricingShares: 2, settlementValue: null },
			],
		});

		expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(
			1,
			8,
		);
	});

	it("keeps independent-set probabilities independent (sum can exceed 1)", () => {
		const probabilities = getMarketProbabilities({
			contractMode: "independent_binary_set",
			winnerCount: 1,
			resolvedAt: null,
			liquidityParameter: 150,
			winningOutcomeId: null,
			outcomes: [
				{ id: "a", pricingShares: 0, settlementValue: null },
				{ id: "b", pricingShares: 0, settlementValue: null },
				{ id: "c", pricingShares: 0, settlementValue: null },
			],
		});

		expect(probabilities).toEqual([0.5, 0.5, 0.5]);
		expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(
			1.5,
			8,
		);
	});

	it("keeps competitive multi-winner marginals summing to winnerCount", () => {
		const probabilities = computeTopKMarginals([7, -4, 2, 1], 150, 2);
		expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(
			2,
			8,
		);
		expect(probabilities.every((value) => value >= 0 && value <= 1)).toBe(true);
	});

	it("starts symmetric top-2 markets at 50% per outcome", () => {
		const probabilities = computeTopKMarginals([0, 0, 0, 0], 150, 2);
		expect(probabilities).toEqual([0.5, 0.5, 0.5, 0.5]);
		expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(
			2,
			8,
		);
	});

	it("increases an outcome marginal after buying it in top-k pricing", () => {
		const shares = [0, 0, 0, 0];
		const before = computeTopKMarginals(shares, 150, 2)[0] ?? 0;
		const bought = solveTopKBuySharesForAmount(shares, 0, 50, 150, 2);
		const after = computeTopKMarginals([bought, 0, 0, 0], 150, 2)[0] ?? 0;

		expect(bought).toBeGreaterThan(0);
		expect(after).toBeGreaterThan(before);
	});

	it("keeps top-k buy cost and immediate unwind payout internally consistent", () => {
		const shares = [12, -3, 4, 0];
		const sharesToBuy = 2.75;
		const buyCost = computeTopKBuyCost(shares, 1, sharesToBuy, 150, 2);
		const unwindPayout = computeTopKSellPayout(
			[12, -3 + sharesToBuy, 4, 0],
			1,
			sharesToBuy,
			150,
			2,
		);

		expect(buyCost).toBeGreaterThan(0);
		expect(unwindPayout).toBeCloseTo(buyCost, 8);
	});

	it("solves top-k short share amounts against desired proceeds", () => {
		const shares = [0, 0, 0, 0];
		const shortShares = solveTopKShortSharesForAmount(shares, 0, 40, 150, 2);
		const proceeds = computeTopKSellPayout(shares, 0, shortShares, 150, 2);

		expect(shortShares).toBeGreaterThan(0);
		expect(proceeds).toBeCloseTo(40, 5);
	});

	it("solves buy share amounts against LMSR cost", () => {
		const shares = [0, 0];
		const delta = solveBuySharesForAmount(shares, 0, 75, 150);
		const before = computeLmsrCost(shares, 150);
		const [firstShare, secondShare] = shares;
		const after = computeLmsrCost(
			[(firstShare ?? 0) + delta, secondShare ?? 0],
			150,
		);

		expect(delta).toBeGreaterThan(0);
		expect(after - before).toBeCloseTo(75, 5);
	});

	it("solves sell share amounts against desired payout", () => {
		const shares = [0, 0];
		const boughtShares = solveBuySharesForAmount(shares, 0, 100, 150);
		const marketShares = [boughtShares, 0];
		const sharesToSell = solveSellSharesForAmount(
			marketShares,
			0,
			40,
			boughtShares,
			150,
		);
		const payout = computeSellPayout(marketShares, 0, sharesToSell, 150);

		expect(sharesToSell).toBeGreaterThan(0);
		expect(sharesToSell).toBeLessThan(boughtShares);
		expect(payout).toBeCloseTo(40, 5);
	});

	it("rejects sell payouts larger than the owned position can support", () => {
		const shares = [0, 0];
		const boughtShares = solveBuySharesForAmount(shares, 0, 25, 150);

		expect(() =>
			solveSellSharesForAmount([boughtShares, 0], 0, 30, boughtShares / 4, 150),
		).toThrow(/enough shares/);
	});

	it("solves short share amounts against desired proceeds", () => {
		const shares = [0, 0];
		const shortShares = solveShortSharesForAmount(shares, 0, 40, 150);
		const proceeds = computeSellPayout(shares, 0, shortShares, 150);

		expect(shortShares).toBeGreaterThan(0);
		expect(proceeds).toBeCloseTo(40, 5);
	});

	it("rejects impossible short payouts in skewed markets", () => {
		const shares = [0, 87.43];

		expect(computeSellPayout(shares, 0, 1_000_000, 150)).toBeCloseTo(66.54, 2);
		expect(() => solveShortSharesForAmount(shares, 0, 100, 150)).toThrow(
			/cannot pay out that many points/i,
		);
	});

	it("computes cover cost for a specific share amount", () => {
		const shares = [-8, 0];
		const cost = computeBuyCost(shares, 0, 3, 150);

		expect(cost).toBeGreaterThan(0);
	});

	it("keeps probabilities and trade costs unchanged when the same constant is added to every outcome", () => {
		const shares = [35, -10, 5];
		const shiftedShares = shares.map((value) => value + 100);
		const probabilities = computeLmsrProbabilities(shares, 150);
		const shiftedProbabilities = computeLmsrProbabilities(shiftedShares, 150);

		probabilities.forEach((value, index) => {
			expect(shiftedProbabilities[index]).toBeCloseTo(value, 10);
		});
		expect(computeBuyCost(shiftedShares, 0, 25, 150)).toBeCloseTo(
			computeBuyCost(shares, 0, 25, 150),
			10,
		);
	});

	it("preserves probabilities when liquidity increases and pricing shares are rebased", () => {
		const shares = [210, 0];
		const rebasedShares = shares.map((value) => value * 2);
		const probabilities = computeLmsrProbabilities(shares, 150);
		const rebasedProbabilities = computeLmsrProbabilities(rebasedShares, 300);

		probabilities.forEach((value, index) => {
			expect(rebasedProbabilities[index]).toBeCloseTo(value, 10);
		});
	});

	it("reduces price impact for the same budget after a liquidity rebase", () => {
		const shares = [210, 0];
		const rebasedShares = shares.map((value) => value * 2);
		const before = computeLmsrProbabilities(rebasedShares, 300)[0] ?? 0;
		const rebasedBuy = solveBuySharesForAmount(rebasedShares, 0, 100, 300);
		const [rebasedFirstShare, rebasedSecondShare] = rebasedShares;
		const [firstShare, secondShare] = shares;
		const after =
			computeLmsrProbabilities(
				[(rebasedFirstShare ?? 0) + rebasedBuy, rebasedSecondShare ?? 0],
				300,
			)[0] ?? 0;
		const originalMove =
			(computeLmsrProbabilities(
				[
					(firstShare ?? 0) + solveBuySharesForAmount(shares, 0, 100, 150),
					secondShare ?? 0,
				],
				150,
			)[0] ?? 0) - (computeLmsrProbabilities(shares, 150)[0] ?? 0);

		expect(after - before).toBeLessThan(originalMove);
	});
});
