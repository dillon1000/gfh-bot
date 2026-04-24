const binarySearchIterations = 60;

const clampSmall = (value: number): number =>
	Math.abs(value) < 1e-9 ? 0 : value;

const computeLogSumExp = (values: number[]): number => {
	if (values.length === 0) {
		return Number.NEGATIVE_INFINITY;
	}

	const max = Math.max(...values);
	const total = values.reduce((sum, value) => sum + Math.exp(value - max), 0);
	return max + Math.log(total);
};

const validateTopKInputs = (
	shares: number[],
	liquidity: number,
	winnerCount: number,
): void => {
	if (!Number.isFinite(liquidity) || liquidity <= 0) {
		throw new Error("Liquidity must be a positive finite number.");
	}

	if (!Number.isInteger(winnerCount) || winnerCount < 0) {
		throw new Error("Winner count must be a non-negative integer.");
	}

	if (winnerCount > shares.length) {
		throw new Error("Winner count cannot exceed the number of outcomes.");
	}
};

export const computeCombinationCount = (n: number, k: number): number => {
	if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0) {
		return 0;
	}

	if (k < 0 || k > n) {
		return 0;
	}

	if (k === 0 || k === n) {
		return 1;
	}

	const smallerK = Math.min(k, n - k);
	let result = 1;
	for (let index = 1; index <= smallerK; index += 1) {
		result = (result * (n - smallerK + index)) / index;
	}

	return Math.round(result);
};

export const enumerateWinnerSubsets = (
	outcomeCount: number,
	winnerCount: number,
): number[][] => {
	if (!Number.isInteger(outcomeCount) || outcomeCount < 0) {
		throw new Error("Outcome count must be a non-negative integer.");
	}

	if (
		!Number.isInteger(winnerCount) ||
		winnerCount < 0 ||
		winnerCount > outcomeCount
	) {
		throw new Error(
			"Winner count must be an integer between 0 and the number of outcomes.",
		);
	}

	if (winnerCount === 0) {
		return [[]];
	}

	const subsets: number[][] = [];
	const current: number[] = [];

	const build = (startIndex: number): void => {
		if (current.length === winnerCount) {
			subsets.push([...current]);
			return;
		}

		const remainingNeeded = winnerCount - current.length;
		for (
			let index = startIndex;
			index <= outcomeCount - remainingNeeded;
			index += 1
		) {
			current.push(index);
			build(index + 1);
			current.pop();
		}
	};

	build(0);
	return subsets;
};

const computeTopKScaledScores = (
	shares: number[],
	liquidity: number,
	winnerCount: number,
): {
	subsets: number[][];
	scaledScores: number[];
} => {
	const subsets = enumerateWinnerSubsets(shares.length, winnerCount);
	const scaledScores = subsets.map((subset) => {
		const score = subset.reduce(
			(sum, outcomeIndex) => sum + (shares[outcomeIndex] ?? 0),
			0,
		);
		return score / liquidity;
	});

	return {
		subsets,
		scaledScores,
	};
};

export const computeTopKCost = (
	shares: number[],
	liquidity: number,
	winnerCount: number,
): number => {
	validateTopKInputs(shares, liquidity, winnerCount);

	if (shares.length === 0 || winnerCount === 0) {
		return 0;
	}

	if (winnerCount === shares.length) {
		return shares.reduce((sum, value) => sum + value, 0);
	}

	const { scaledScores } = computeTopKScaledScores(
		shares,
		liquidity,
		winnerCount,
	);
	return liquidity * computeLogSumExp(scaledScores);
};

export const computeTopKMarginals = (
	shares: number[],
	liquidity: number,
	winnerCount: number,
): number[] => {
	validateTopKInputs(shares, liquidity, winnerCount);

	if (shares.length === 0) {
		return [];
	}

	if (winnerCount === 0) {
		return shares.map(() => 0);
	}

	if (winnerCount === shares.length) {
		return shares.map(() => 1);
	}

	const { subsets, scaledScores } = computeTopKScaledScores(
		shares,
		liquidity,
		winnerCount,
	);
	const max = Math.max(...scaledScores);
	const weights = scaledScores.map((value) => Math.exp(value - max));
	const totalWeight = weights.reduce((sum, value) => sum + value, 0);
	const marginals = shares.map(() => 0);

	subsets.forEach((subset, subsetIndex) => {
		const stateProbability = (weights[subsetIndex] ?? 0) / totalWeight;
		subset.forEach((outcomeIndex) => {
			marginals[outcomeIndex] =
				(marginals[outcomeIndex] ?? 0) + stateProbability;
		});
	});

	return marginals;
};

export const computeTopKBuyCost = (
	shares: number[],
	outcomeIndex: number,
	sharesToBuy: number,
	liquidity: number,
	winnerCount: number,
): number => {
	const baseline = computeTopKCost(shares, liquidity, winnerCount);
	const nextShares = shares.map((value, index) =>
		index === outcomeIndex ? value + sharesToBuy : value,
	);
	return clampSmall(
		computeTopKCost(nextShares, liquidity, winnerCount) - baseline,
	);
};

export const computeTopKSellPayout = (
	shares: number[],
	outcomeIndex: number,
	sharesToSell: number,
	liquidity: number,
	winnerCount: number,
): number => {
	const baseline = computeTopKCost(shares, liquidity, winnerCount);
	const nextShares = shares.map((value, index) =>
		index === outcomeIndex ? value - sharesToSell : value,
	);
	return clampSmall(
		baseline - computeTopKCost(nextShares, liquidity, winnerCount),
	);
};

export const solveTopKBuySharesForAmount = (
	shares: number[],
	outcomeIndex: number,
	amount: number,
	liquidity: number,
	winnerCount: number,
): number => {
	const baseline = computeTopKCost(shares, liquidity, winnerCount);
	let low = 0;
	let high = Math.max(1, amount);

	while (
		computeTopKCost(
			shares.map((value, index) =>
				index === outcomeIndex ? value + high : value,
			),
			liquidity,
			winnerCount,
		) -
			baseline <
		amount
	) {
		high *= 2;
	}

	for (let index = 0; index < binarySearchIterations; index += 1) {
		const mid = (low + high) / 2;
		const nextShares = shares.map((value, shareIndex) =>
			shareIndex === outcomeIndex ? value + mid : value,
		);
		const costDelta =
			computeTopKCost(nextShares, liquidity, winnerCount) - baseline;
		if (costDelta < amount) {
			low = mid;
		} else {
			high = mid;
		}
	}

	return clampSmall(high);
};

export const solveTopKSellSharesForAmount = (
	shares: number[],
	outcomeIndex: number,
	desiredPayout: number,
	ownedShares: number,
	liquidity: number,
	winnerCount: number,
): number => {
	const maxPayout = computeTopKSellPayout(
		shares,
		outcomeIndex,
		ownedShares,
		liquidity,
		winnerCount,
	);
	if (desiredPayout > maxPayout + 1e-6) {
		throw new Error(
			"You do not have enough shares in that outcome to sell that much.",
		);
	}

	let low = 0;
	let high = ownedShares;

	for (let index = 0; index < binarySearchIterations; index += 1) {
		const mid = (low + high) / 2;
		const payout = computeTopKSellPayout(
			shares,
			outcomeIndex,
			mid,
			liquidity,
			winnerCount,
		);
		if (payout < desiredPayout) {
			low = mid;
		} else {
			high = mid;
		}
	}

	return clampSmall(high);
};

export const computeLmsrCost = (
	shares: number[],
	liquidity: number,
): number => {
	const scaled = shares.map((value) => value / liquidity);
	const max = Math.max(...scaled);
	const total = scaled.reduce((sum, value) => sum + Math.exp(value - max), 0);
	return liquidity * (max + Math.log(total));
};

export const computeLmsrProbabilities = (
	shares: number[],
	liquidity: number,
): number[] => {
	const scaled = shares.map((value) => value / liquidity);
	const max = Math.max(...scaled);
	const exps = scaled.map((value) => Math.exp(value - max));
	const total = exps.reduce((sum, value) => sum + value, 0);
	return exps.map((value) => value / total);
};

export const computeBinaryLmsrCost = (
	shares: number,
	liquidity: number,
): number => liquidity * Math.log1p(Math.exp(shares / liquidity));

export const computeBinaryLmsrProbability = (
	shares: number,
	liquidity: number,
): number => 1 / (1 + Math.exp(-(shares / liquidity)));

export const computeBinaryBuyCost = (
	shares: number,
	sharesToBuy: number,
	liquidity: number,
): number =>
	clampSmall(
		computeBinaryLmsrCost(shares + sharesToBuy, liquidity) -
			computeBinaryLmsrCost(shares, liquidity),
	);

export const computeBinarySellPayout = (
	shares: number,
	sharesToSell: number,
	liquidity: number,
): number =>
	clampSmall(
		computeBinaryLmsrCost(shares, liquidity) -
			computeBinaryLmsrCost(shares - sharesToSell, liquidity),
	);

export const solveBinaryBuySharesForAmount = (
	shares: number,
	amount: number,
	liquidity: number,
): number => {
	const baseline = computeBinaryLmsrCost(shares, liquidity);
	let low = 0;
	let high = Math.max(1, amount);

	while (computeBinaryLmsrCost(shares + high, liquidity) - baseline < amount) {
		high *= 2;
	}

	for (let index = 0; index < binarySearchIterations; index += 1) {
		const mid = (low + high) / 2;
		const costDelta = computeBinaryLmsrCost(shares + mid, liquidity) - baseline;
		if (costDelta < amount) {
			low = mid;
		} else {
			high = mid;
		}
	}

	return clampSmall(high);
};

export const solveBinarySellSharesForAmount = (
	shares: number,
	desiredPayout: number,
	ownedShares: number,
	liquidity: number,
): number => {
	const maxPayout = computeBinarySellPayout(shares, ownedShares, liquidity);
	if (desiredPayout > maxPayout + 1e-6) {
		throw new Error(
			"You do not have enough shares in that outcome to sell that much.",
		);
	}

	let low = 0;
	let high = ownedShares;

	for (let index = 0; index < binarySearchIterations; index += 1) {
		const mid = (low + high) / 2;
		const payout = computeBinarySellPayout(shares, mid, liquidity);
		if (payout < desiredPayout) {
			low = mid;
		} else {
			high = mid;
		}
	}

	return clampSmall(high);
};

const computeTopKMaxShortPayout = (
	shares: number[],
	outcomeIndex: number,
	liquidity: number,
	winnerCount: number,
): number => {
	const baseline = computeTopKCost(shares, liquidity, winnerCount);
	if (winnerCount === shares.length) {
		return Number.POSITIVE_INFINITY;
	}

	const remainingShares = shares.filter((_, index) => index !== outcomeIndex);
	const minCost = computeTopKCost(remainingShares, liquidity, winnerCount);
	return clampSmall(baseline - minCost);
};

export const solveTopKShortSharesForAmount = (
	shares: number[],
	outcomeIndex: number,
	desiredPayout: number,
	liquidity: number,
	winnerCount: number,
): number => {
	const maxPayout = computeTopKMaxShortPayout(
		shares,
		outcomeIndex,
		liquidity,
		winnerCount,
	);
	if (desiredPayout > maxPayout + 1e-6) {
		throw new Error(
			"That short cannot pay out that many points. Try a smaller point amount or specify shares.",
		);
	}

	let low = 0;
	let high = Math.max(1, desiredPayout);

	while (
		computeTopKSellPayout(
			shares,
			outcomeIndex,
			high,
			liquidity,
			winnerCount,
		) < desiredPayout
	) {
		high *= 2;
	}

	for (let index = 0; index < binarySearchIterations; index += 1) {
		const mid = (low + high) / 2;
		const payout = computeTopKSellPayout(
			shares,
			outcomeIndex,
			mid,
			liquidity,
			winnerCount,
		);
		if (payout < desiredPayout) {
			low = mid;
		} else {
			high = mid;
		}
	}

	return clampSmall(high);
};

export const solveBinaryShortSharesForAmount = (
	shares: number,
	desiredPayout: number,
	liquidity: number,
): number => {
	const maxPayout = computeBinaryLmsrCost(shares, liquidity);
	if (desiredPayout > maxPayout + 1e-6) {
		throw new Error(
			"That short cannot pay out that many points. Try a smaller point amount or specify shares.",
		);
	}

	let low = 0;
	let high = Math.max(1, desiredPayout);

	while (computeBinarySellPayout(shares, high, liquidity) < desiredPayout) {
		high *= 2;
	}

	for (let index = 0; index < binarySearchIterations; index += 1) {
		const mid = (low + high) / 2;
		const payout = computeBinarySellPayout(shares, mid, liquidity);
		if (payout < desiredPayout) {
			low = mid;
		} else {
			high = mid;
		}
	}

	return clampSmall(high);
};

export const solveBuySharesForAmount = (
	shares: number[],
	outcomeIndex: number,
	amount: number,
	liquidity: number,
): number => {
	const baseline = computeLmsrCost(shares, liquidity);
	let low = 0;
	let high = Math.max(1, amount);

	while (
		computeLmsrCost(
			shares.map((value, index) =>
				index === outcomeIndex ? value + high : value,
			),
			liquidity,
		) -
			baseline <
		amount
	) {
		high *= 2;
	}

	for (let index = 0; index < binarySearchIterations; index += 1) {
		const mid = (low + high) / 2;
		const nextShares = shares.map((value, shareIndex) =>
			shareIndex === outcomeIndex ? value + mid : value,
		);
		const costDelta = computeLmsrCost(nextShares, liquidity) - baseline;
		if (costDelta < amount) {
			low = mid;
		} else {
			high = mid;
		}
	}

	return clampSmall(high);
};

export const computeBuyCost = (
	shares: number[],
	outcomeIndex: number,
	sharesToBuy: number,
	liquidity: number,
): number => {
	const baseline = computeLmsrCost(shares, liquidity);
	const nextShares = shares.map((value, index) =>
		index === outcomeIndex ? value + sharesToBuy : value,
	);
	return clampSmall(computeLmsrCost(nextShares, liquidity) - baseline);
};

export const computeSellPayout = (
	shares: number[],
	outcomeIndex: number,
	sharesToSell: number,
	liquidity: number,
): number => {
	const baseline = computeLmsrCost(shares, liquidity);
	const nextShares = shares.map((value, index) =>
		index === outcomeIndex ? value - sharesToSell : value,
	);
	return clampSmall(baseline - computeLmsrCost(nextShares, liquidity));
};

const computeMaxShortPayout = (
	shares: number[],
	outcomeIndex: number,
	liquidity: number,
): number => {
	const baseline = computeLmsrCost(shares, liquidity);
	const remainingScaled = shares
		.filter((_, index) => index !== outcomeIndex)
		.map((value) => value / liquidity);

	if (remainingScaled.length === 0) {
		return 0;
	}

	const max = Math.max(...remainingScaled);
	const total = remainingScaled.reduce(
		(sum, value) => sum + Math.exp(value - max),
		0,
	);
	const minCost = liquidity * (max + Math.log(total));
	return clampSmall(baseline - minCost);
};

export const solveSellSharesForAmount = (
	shares: number[],
	outcomeIndex: number,
	desiredPayout: number,
	ownedShares: number,
	liquidity: number,
): number => {
	const maxPayout = computeSellPayout(
		shares,
		outcomeIndex,
		ownedShares,
		liquidity,
	);
	if (desiredPayout > maxPayout + 1e-6) {
		throw new Error(
			"You do not have enough shares in that outcome to sell that much.",
		);
	}

	let low = 0;
	let high = ownedShares;

	for (let index = 0; index < binarySearchIterations; index += 1) {
		const mid = (low + high) / 2;
		const payout = computeSellPayout(shares, outcomeIndex, mid, liquidity);
		if (payout < desiredPayout) {
			low = mid;
		} else {
			high = mid;
		}
	}

	return clampSmall(high);
};

export const solveShortSharesForAmount = (
	shares: number[],
	outcomeIndex: number,
	desiredPayout: number,
	liquidity: number,
): number => {
	const maxPayout = computeMaxShortPayout(shares, outcomeIndex, liquidity);
	if (desiredPayout > maxPayout + 1e-6) {
		throw new Error(
			"That short cannot pay out that many points. Try a smaller point amount or specify shares.",
		);
	}

	let low = 0;
	let high = Math.max(1, desiredPayout);

	while (
		computeSellPayout(shares, outcomeIndex, high, liquidity) < desiredPayout
	) {
		high *= 2;
	}

	for (let index = 0; index < binarySearchIterations; index += 1) {
		const mid = (low + high) / 2;
		const payout = computeSellPayout(shares, outcomeIndex, mid, liquidity);
		if (payout < desiredPayout) {
			low = mid;
		} else {
			high = mid;
		}
	}

	return clampSmall(high);
};

export const formatProbabilityPercent = (value: number): string =>
	`${(value * 100).toFixed(1)}%`;
