import { AttachmentBuilder } from "discord.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createCanvas,
	GlobalFonts,
	loadImage,
	type SKRSContext2D,
} from "@napi-rs/canvas";
import {
	bin,
	line,
	scaleBand,
	scaleLinear,
	scaleOrdinal,
	scaleTime,
	schemeTableau10,
} from "d3";

import {
	compareMarketHistoryEvents,
	computeMarketSummary,
	getMarketProbabilities,
	getMarketStatus,
} from "../core/shared.js";
import type { MarketWithRelations } from "../core/types.js";

const width = 1200;
const height = 760;
const background = "#15181d";
const border = "#2b313a";
const text = "#f4f7fb";
const muted = "#a3adba";
const quiet = "#66707d";
const grid = "#2f3640";
const gridStrong = "#404856";
const volumeColor = "#6f8fc0";
const fontFamily = "Public Sans";
const fontStack = `'${fontFamily}', 'DejaVu Sans', 'Noto Sans', 'Liberation Sans', sans-serif`;
const PROBABILITY_EPSILON = 1e-6;
const VOLUME_BUCKET_COUNT = 28;

const seriesPalette = schemeTableau10.concat([
	"#7cb7ff",
	"#ff9f43",
	"#5fd0a5",
	"#ff6b8a",
	"#c490ff",
	"#ffd166",
	"#8ce99a",
	"#7bdff2",
]);

const tablerIconNames = {
	volume: "coins",
	trades: "chart-histogram",
	state: "clock",
	bonusBank: "wallet",
} as const;

type LoadedImage = Awaited<ReturnType<typeof loadImage>>;

type DiagramPayload = {
	attachment: AttachmentBuilder;
	fileName: string;
};

type Snapshot = {
	at: Date;
	probabilities: number[];
	cumulativeVolume: number;
};

type HistoryEvent =
	| {
			kind: "trade";
			createdAt: Date;
			outcomeId: string;
			shareDelta: number;
			cumulativeVolume: number;
	  }
	| {
			kind: "liquidity";
			createdAt: Date;
			scaleFactor: number;
			liquidityParameter: number;
	  };

export type ChartBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type ProbabilityPoint = {
	time: number;
	probability: number;
};

export type ProbabilitySeries = {
	outcomeId: string;
	label: string;
	color: string;
	latestProbability: number;
	points: ProbabilityPoint[];
};

export type VolumeBucket = {
	index: number;
	startTime: number;
	endTime: number;
	volume: number;
	tradeCount: number;
};

export type MetadataItem = {
	icon: keyof typeof tablerIconNames;
	label: string;
	value: string;
	accent: string;
};

export type MarketChartModel = {
	startTime: number;
	endTime: number;
	probabilitySeries: ProbabilitySeries[];
	volumeBuckets: VolumeBucket[];
	maxBucketVolume: number;
	metadata: MetadataItem[];
	liquidityMarkers: Array<{
		time: number;
		label: string;
	}>;
};

const imageCache = new Map<string, Promise<LoadedImage | null>>();

const axisDateFormatter = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
});

const axisDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "numeric",
});

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 1,
	notation: "compact",
});
const footerDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	timeZoneName: "short",
});

let publicSansRegistered = false;

const drawLabel = (
	context: SKRSContext2D,
	label: string,
	x: number,
	y: number,
	options: {
		font: string;
		color: string;
		align?: CanvasTextAlign;
		baseline?: CanvasTextBaseline;
	},
): void => {
	context.font = options.font;
	context.fillStyle = options.color;
	context.textAlign = options.align ?? "left";
	context.textBaseline = options.baseline ?? "alphabetic";
	context.fillText(label, x, y);
};

const truncateToWidth = (
	context: SKRSContext2D,
	label: string,
	maxWidth: number,
): string => {
	if (context.measureText(label).width <= maxWidth) {
		return label;
	}

	let value = label;
	while (
		value.length > 1 &&
		context.measureText(`${value}...`).width > maxWidth
	) {
		value = value.slice(0, -1);
	}

	return `${value}...`;
};

const wrapText = (
	context: SKRSContext2D,
	label: string,
	maxWidth: number,
	maxLines: number,
): string[] => {
	const words = label.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		return [""];
	}

	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (context.measureText(next).width <= maxWidth) {
			current = next;
			continue;
		}

		if (current) {
			lines.push(current);
		}
		current = word;

		if (lines.length === maxLines - 1) {
			break;
		}
	}

	if (lines.length < maxLines) {
		lines.push(current);
	}

	const consumedWordCount = lines
		.join(" ")
		.trim()
		.split(/\s+/)
		.filter(Boolean).length;
	if (consumedWordCount < words.length) {
		const lastLine = lines[lines.length - 1] ?? "";
		lines[lines.length - 1] = truncateToWidth(
			context,
			`${lastLine} ${words.slice(consumedWordCount).join(" ")}`.trim(),
			maxWidth,
		);
	}

	return lines.slice(0, maxLines);
};

const formatPercent = (value: number, digits = 1): string =>
	`${(value * 100).toFixed(digits)}%`;

const formatPoints = (value: number): string => {
	const rounded = Math.round(value);
	if (Math.abs(value - rounded) < 0.01) {
		return `${rounded} pts`;
	}

	return `${value.toFixed(1)} pts`;
};

const formatCompactPoints = (value: number): string =>
	`${compactNumberFormatter.format(value)} pts`;

const formatAxisTime = (
	value: number,
	startTime: number,
	endTime: number,
): string =>
	(endTime - startTime <= 36 * 60 * 60 * 1_000
		? axisDateTimeFormatter
		: axisDateFormatter
	).format(new Date(value));

const formatFooterTimestamp = (value: Date): string =>
	footerDateTimeFormatter.format(value);

const resolvePublicSansPath = (
	weight: 400 | 500 | 700,
	moduleUrl: string = import.meta.url,
): string | null => {
	const relativePath = `files/public-sans-latin-${weight}-normal.woff2`;
	const candidates = [
		resolve(
			process.cwd(),
			"node_modules",
			"@fontsource",
			"public-sans",
			relativePath,
		),
		fileURLToPath(
			new URL(
				`../../../../node_modules/@fontsource/public-sans/${relativePath}`,
				moduleUrl,
			),
		),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return null;
};

const ensurePublicSansLoaded = (): void => {
	if (publicSansRegistered) {
		return;
	}

	for (const weight of [400, 500, 700] as const) {
		const path = resolvePublicSansPath(weight);
		if (path) {
			GlobalFonts.registerFromPath(path, fontFamily);
		}
	}

	publicSansRegistered = true;
};

const resolveTablerIconPath = (
	iconName: string,
	moduleUrl: string = import.meta.url,
): string | null => {
	const relativePath = `icons/outline/${iconName}.svg`;
	const candidates = [
		resolve(process.cwd(), "node_modules", "@tabler", "icons", relativePath),
		fileURLToPath(
			new URL(
				`../../../../node_modules/@tabler/icons/${relativePath}`,
				moduleUrl,
			),
		),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return null;
};

const loadTablerIcon = async (
	iconName: keyof typeof tablerIconNames,
	size: number,
	tint: string,
): Promise<LoadedImage | null> => {
	const file = resolveTablerIconPath(tablerIconNames[iconName]);
	if (!file) {
		return null;
	}

	const cacheKey = `${file}:${size}:${tint}`;
	const cached = imageCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const pending = readFile(file, "utf8")
		.then((svg) =>
			svg
				.replace("<svg ", `<svg width="${size}" height="${size}" `)
				.replaceAll("currentColor", tint),
		)
		.then((svg) => loadImage(Buffer.from(svg)));

	imageCache.set(cacheKey, pending);
	return pending;
};

export const resolveMarketDiagramEndTime = (
	market: MarketWithRelations,
	now = new Date(),
): Date => {
	if (market.resolvedAt) {
		return market.resolvedAt;
	}

	if (market.cancelledAt) {
		return market.cancelledAt;
	}

	if (market.tradingClosedAt) {
		return market.tradingClosedAt;
	}

	let latestHistoryTime = market.createdAt.getTime();

	for (const trade of market.trades) {
		latestHistoryTime = Math.max(latestHistoryTime, trade.createdAt.getTime());
	}

	for (const event of market.liquidityEvents) {
		latestHistoryTime = Math.max(latestHistoryTime, event.createdAt.getTime());
	}

	return new Date(Math.max(now.getTime(), latestHistoryTime));
};

export const buildSnapshots = (
	market: MarketWithRelations,
	now = new Date(),
): Snapshot[] => {
	const pricingShares = market.outcomes.map(() => 0);
	let liquidityParameter = market.baseLiquidityParameter;
	const computeSnapshotProbabilities = (at: Date): number[] =>
		getMarketProbabilities({
			contractMode: market.contractMode ?? null,
			winnerCount: market.winnerCount,
			liquidityParameter,
			resolvedAt: null,
			winningOutcomeId: market.winningOutcomeId,
			outcomes: market.outcomes.map((outcome, index) => ({
				id: outcome.id,
				pricingShares: pricingShares[index] ?? 0,
				settlementValue:
					outcome.resolvedAt && outcome.resolvedAt.getTime() <= at.getTime()
						? outcome.settlementValue
						: null,
			})),
		});
	const initialProbabilities = computeSnapshotProbabilities(market.createdAt);
	const snapshots: Snapshot[] = [
		{
			at: market.createdAt,
			probabilities: initialProbabilities,
			cumulativeVolume: 0,
		},
	];

	const history: HistoryEvent[] = [
		...market.trades.map((trade) => ({
			kind: "trade" as const,
			createdAt: trade.createdAt,
			outcomeId: trade.outcomeId,
			shareDelta: trade.shareDelta,
			cumulativeVolume: trade.cumulativeVolume,
		})),
		...market.liquidityEvents.map((event) => ({
			kind: "liquidity" as const,
			createdAt: event.createdAt,
			scaleFactor: event.scaleFactor,
			liquidityParameter: event.nextLiquidityParameter,
		})),
	].sort(compareMarketHistoryEvents);

	for (const event of history) {
		if (event.kind === "liquidity") {
			liquidityParameter = event.liquidityParameter;
			for (let index = 0; index < market.outcomes.length; index += 1) {
				const outcome = market.outcomes[index];
				if (
					outcome?.resolvedAt &&
					outcome.resolvedAt.getTime() <= event.createdAt.getTime()
				) {
					continue;
				}

				pricingShares[index] = (pricingShares[index] ?? 0) * event.scaleFactor;
			}

			snapshots.push({
				at: event.createdAt,
				probabilities: computeSnapshotProbabilities(event.createdAt),
				cumulativeVolume:
					snapshots[snapshots.length - 1]?.cumulativeVolume ?? 0,
			});
			continue;
		}

		const outcomeIndex = market.outcomes.findIndex(
			(outcome) => outcome.id === event.outcomeId,
		);
		if (outcomeIndex >= 0) {
			pricingShares[outcomeIndex] =
				(pricingShares[outcomeIndex] ?? 0) + event.shareDelta;
		}

		snapshots.push({
			at: event.createdAt,
			probabilities: computeSnapshotProbabilities(event.createdAt),
			cumulativeVolume: event.cumulativeVolume,
		});
	}

	if (snapshots.length === 1) {
		snapshots.push({
			at: resolveMarketDiagramEndTime(market, now),
			probabilities: initialProbabilities,
			cumulativeVolume: 0,
		});
	}

	const finalProbabilities = computeMarketSummary(market).probabilities.map(
		(entry) => entry.probability,
	);
	const latestSnapshot = snapshots[snapshots.length - 1];
	const needsTerminalSnapshot =
		market.outcomes.some((outcome) => outcome.settlementValue !== null) ||
		latestSnapshot?.probabilities.some(
			(value, index) =>
				Math.abs(value - (finalProbabilities[index] ?? 0)) >
				PROBABILITY_EPSILON,
		);
	if (needsTerminalSnapshot) {
		snapshots.push({
			at: resolveMarketDiagramEndTime(market, now),
			probabilities: finalProbabilities,
			cumulativeVolume: market.totalVolume,
		});
	}

	return snapshots;
};

export const bucketTradeVolumes = (
	market: MarketWithRelations,
	startTime: number,
	endTime: number,
	bucketCount = VOLUME_BUCKET_COUNT,
): VolumeBucket[] => {
	if (bucketCount <= 0) {
		return [];
	}

	const safeEndTime = Math.max(startTime + 1, endTime);
	const bucketSpan = (safeEndTime - startTime) / bucketCount;
	const thresholds = Array.from({ length: bucketCount + 1 }, (_, index) =>
		index === bucketCount ? safeEndTime : startTime + bucketSpan * index,
	);
	const sortedTrades = [...market.trades].sort(
		(left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
	);
	let previousCumulativeVolume = 0;
	const tradeDeltas = sortedTrades.map((trade) => {
		const delta = Math.max(
			0,
			trade.cumulativeVolume - previousCumulativeVolume,
		);
		previousCumulativeVolume = trade.cumulativeVolume;
		return {
			time: trade.createdAt.getTime(),
			volume: delta,
		};
	});
	const histogram = bin<{ time: number; volume: number }, number>()
		.value((trade) => trade.time)
		.domain([startTime, safeEndTime])
		.thresholds(thresholds);
	const bins = histogram(tradeDeltas);

	return Array.from({ length: bucketCount }, (_, index) => {
		const bucket = bins[index];
		return {
			index,
			startTime: thresholds[index] ?? startTime,
			endTime: thresholds[index + 1] ?? safeEndTime,
			volume: bucket?.reduce((sum, trade) => sum + trade.volume, 0) ?? 0,
			tradeCount: bucket?.length ?? 0,
		};
	});
};

const buildMetadata = (market: MarketWithRelations): MetadataItem[] => {
	const status = getMarketStatus(market);
	const stateAccent =
		status === "resolved"
			? "#5fd0a5"
			: status === "cancelled"
				? "#ff7d7d"
				: status === "closed"
					? "#ffb454"
					: "#7cb7ff";

	const stateLabel =
		status === "open"
			? `Closes ${axisDateFormatter.format(market.closeAt)}`
			: status === "closed"
				? `Closed ${axisDateFormatter.format(market.tradingClosedAt ?? market.closeAt)}`
				: status === "resolved"
					? `Resolved ${axisDateFormatter.format(market.resolvedAt ?? market.closeAt)}`
					: `Cancelled ${axisDateFormatter.format(market.cancelledAt ?? market.closeAt)}`;

	return [
		{
			icon: "volume",
			value: formatCompactPoints(market.totalVolume),
			label: "Total volume",
			accent: text,
		},
		{
			icon: "trades",
			value: compactNumberFormatter.format(market.trades.length),
			label: "Trades",
			accent: text,
		},
		{
			icon: "state",
			value: status.charAt(0).toUpperCase() + status.slice(1),
			label: stateLabel,
			accent: stateAccent,
		},
		{
			icon: "bonusBank",
			value: formatCompactPoints(market.supplementaryBonusPool ?? 0),
			label: "Bonus bank",
			accent: text,
		},
	];
};

export const buildMarketChartModel = (
	market: MarketWithRelations,
	now = new Date(),
): MarketChartModel => {
	const snapshots = buildSnapshots(market, now);
	const summary = computeMarketSummary(market);
	const colorScale = scaleOrdinal<string, string>()
		.domain(summary.probabilities.map((entry) => entry.outcomeId))
		.range(seriesPalette);
	const startTime = snapshots[0]?.at.getTime() ?? market.createdAt.getTime();
	const endTime = Math.max(
		resolveMarketDiagramEndTime(market, now).getTime(),
		snapshots[snapshots.length - 1]?.at.getTime() ?? startTime + 1,
		startTime + 1,
	);
	const volumeBuckets = bucketTradeVolumes(market, startTime, endTime);
	const maxBucketVolume = Math.max(
		...volumeBuckets.map((bucket) => bucket.volume),
		1,
	);

	return {
		startTime,
		endTime,
		probabilitySeries: summary.probabilities.map((entry, index) => ({
			outcomeId: entry.outcomeId,
			label: entry.label,
			color:
				colorScale(entry.outcomeId) ??
				seriesPalette[index % seriesPalette.length] ??
				seriesPalette[0]!,
			latestProbability: entry.probability,
			points: snapshots.map((snapshot) => ({
				time: snapshot.at.getTime(),
				probability: snapshot.probabilities[index] ?? 0,
			})),
		})),
		volumeBuckets,
		maxBucketVolume,
		metadata: buildMetadata(market),
		liquidityMarkers: market.liquidityEvents.map((event) => ({
			time: event.createdAt.getTime(),
			label: `b=${event.nextLiquidityParameter.toFixed(0)}`,
		})),
	};
};

const fillCircle = (
	context: SKRSContext2D,
	x: number,
	y: number,
	radius: number,
	fillStyle: string,
): void => {
	context.beginPath();
	context.arc(x, y, radius, 0, Math.PI * 2);
	context.fillStyle = fillStyle;
	context.fill();
};

const getProbabilityDomain = (
	series: ProbabilitySeries[],
): [number, number] => {
	const values = series.flatMap((entry) =>
		entry.points.map((point) => point.probability),
	);
	const min = Math.min(...values, 0.5);
	const max = Math.max(...values, 0.5);
	const span = max - min;
	const paddedSpan = Math.max(0.14, span + 0.08);
	const midpoint = (min + max) / 2;
	const lower = Math.max(0, midpoint - paddedSpan / 2);
	const upper = Math.min(1, midpoint + paddedSpan / 2);

	if (upper - lower >= 0.14) {
		return [lower, upper];
	}

	if (lower <= 0) {
		return [0, Math.min(1, 0.14)];
	}

	return [Math.max(0, 1 - 0.14), 1];
};

const drawProbabilityGrid = (
	context: SKRSContext2D,
	bounds: ChartBounds,
	domain: [number, number],
): void => {
	const scale = scaleLinear()
		.domain(domain)
		.range([bounds.y + bounds.height, bounds.y]);
	const ticks = scale.ticks(5);
	context.lineWidth = 1;

	for (const tick of ticks) {
		const y = scale(tick);
		context.strokeStyle = tick === 0 || tick === 1 ? gridStrong : grid;
		context.beginPath();
		context.moveTo(bounds.x, y);
		context.lineTo(bounds.x + bounds.width, y);
		context.stroke();

		drawLabel(context, formatPercent(tick, 0), bounds.x - 16, y, {
			font: `13px ${fontStack}`,
			color: muted,
			align: "right",
			baseline: "middle",
		});
	}
};

const drawVolumeGrid = (
	context: SKRSContext2D,
	bounds: ChartBounds,
	maxBucketVolume: number,
): void => {
	const scale = scaleLinear()
		.domain([0, Math.max(1, maxBucketVolume)])
		.range([bounds.y + bounds.height, bounds.y]);
	const ticks = scale.ticks(2);
	const topY = scale(maxBucketVolume);
	const bottomY = scale(0);

	context.lineWidth = 1;
	context.strokeStyle = gridStrong;
	context.beginPath();
	context.moveTo(bounds.x, topY);
	context.lineTo(bounds.x + bounds.width, topY);
	context.stroke();

	context.strokeStyle = grid;
	context.beginPath();
	context.moveTo(bounds.x, bottomY);
	context.lineTo(bounds.x + bounds.width, bottomY);
	context.stroke();

	ticks.forEach((tick) => {
		const y = scale(tick);
		if (tick > 0 && tick < maxBucketVolume) {
			context.strokeStyle = grid;
			context.beginPath();
			context.moveTo(bounds.x, y);
			context.lineTo(bounds.x + bounds.width, y);
			context.stroke();
		}

		drawLabel(context, compactNumberFormatter.format(tick), bounds.x - 16, y, {
			font: `13px ${fontStack}`,
			color: muted,
			align: "right",
			baseline: "middle",
		});
	});
};

const drawStepSeries = (
	context: SKRSContext2D,
	bounds: ChartBounds,
	series: ProbabilitySeries,
	startTime: number,
	endTime: number,
	domain: [number, number],
): void => {
	if (series.points.length === 0) {
		return;
	}

	const xScale = scaleTime<number, number>()
		.domain([new Date(startTime), new Date(endTime)])
		.range([bounds.x, bounds.x + bounds.width]);
	const yScale = scaleLinear()
		.domain(domain)
		.range([bounds.y + bounds.height, bounds.y]);
	const lineGenerator = line<ProbabilityPoint>()
		.x((point) => xScale(new Date(point.time)))
		.y((point) => yScale(point.probability))
		.context(context as never);

	context.save();
	context.beginPath();
	context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
	context.clip();
	context.lineWidth = 3;
	context.strokeStyle = series.color;
	context.lineCap = "round";
	context.lineJoin = "round";
	context.beginPath();
	lineGenerator(series.points);
	context.stroke();

	const latest = series.points[series.points.length - 1]!;
	fillCircle(
		context,
		xScale(new Date(latest.time)),
		yScale(latest.probability),
		5.5,
		series.color,
	);
	context.lineWidth = 2;
	context.strokeStyle = background;
	context.beginPath();
	context.arc(
		xScale(new Date(latest.time)),
		yScale(latest.probability),
		5.5,
		0,
		Math.PI * 2,
	);
	context.stroke();
	context.restore();
};

const drawLiquidityMarkers = (
	context: SKRSContext2D,
	bounds: ChartBounds,
	startTime: number,
	endTime: number,
	markers: Array<{ time: number; label: string }>,
): void => {
	if (markers.length === 0) {
		return;
	}

	const xScale = scaleTime<number, number>()
		.domain([new Date(startTime), new Date(endTime)])
		.range([bounds.x, bounds.x + bounds.width]);

	markers.forEach((marker, index) => {
		const x = xScale(new Date(marker.time));
		const chipY = bounds.y + 10 + (index % 2) * 18;

		context.save();
		context.strokeStyle = "rgba(163, 173, 186, 0.28)";
		context.lineWidth = 1;
		context.setLineDash([5, 5]);
		context.beginPath();
		context.moveTo(x, bounds.y);
		context.lineTo(x, bounds.y + bounds.height);
		context.stroke();
		context.setLineDash([]);

		context.beginPath();
		context.arc(x, chipY + 1, 3, 0, Math.PI * 2);
		context.fillStyle = "#8ea1b8";
		context.fill();

		drawLabel(context, marker.label, x + 8, chipY + 4, {
			font: `600 12px ${fontStack}`,
			color: muted,
			baseline: "middle",
		});
		context.restore();
	});
};

const drawVolumeHistogram = (
	context: SKRSContext2D,
	bounds: ChartBounds,
	buckets: VolumeBucket[],
	maxBucketVolume: number,
): void => {
	if (buckets.length === 0) {
		return;
	}

	const xScale = scaleBand<string>()
		.domain(buckets.map((bucket) => bucket.index.toString()))
		.range([bounds.x, bounds.x + bounds.width])
		.paddingInner(0.14)
		.paddingOuter(0.04);
	const yScale = scaleLinear()
		.domain([0, Math.max(1, maxBucketVolume)])
		.range([bounds.y + bounds.height, bounds.y]);

	buckets.forEach((bucket) => {
		const x = xScale(bucket.index.toString());
		if (x === undefined) {
			return;
		}
		const y = yScale(bucket.volume);
		const barWidth = xScale.bandwidth();
		const barHeight = Math.max(1.5, bounds.y + bounds.height - y);

		context.fillStyle =
			bucket.volume > 0 ? volumeColor : "rgba(111, 143, 192, 0.18)";
		context.fillRect(x, y, Math.max(1, barWidth), barHeight);
	});
};

const drawTimeAxis = (
	context: SKRSContext2D,
	bounds: ChartBounds,
	startTime: number,
	endTime: number,
): void => {
	const scale = scaleTime<number, number>()
		.domain([new Date(startTime), new Date(endTime)])
		.range([bounds.x, bounds.x + bounds.width]);
	const ticks = scale.ticks(4);
	ticks.forEach((tick, index) => {
		const x = scale(tick);
		drawLabel(
			context,
			formatAxisTime(tick.getTime(), startTime, endTime),
			x,
			bounds.y + bounds.height + 28,
			{
				font: `13px ${fontStack}`,
				color: muted,
				align:
					index === 0
						? "left"
						: index === ticks.length - 1
							? "right"
							: "center",
			},
		);
	});
};

const drawMetadataItem = async (
	context: SKRSContext2D,
	item: MetadataItem,
	x: number,
	y: number,
): Promise<void> => {
	const icon = await loadTablerIcon(item.icon, 20, item.accent);
	const textX = icon ? x + 30 : x;
	if (icon) {
		context.drawImage(icon, x, y + 4, 20, 20);
	}

	drawLabel(context, item.value, textX, y + 15, {
		font: `700 20px ${fontStack}`,
		color: item.accent,
	});
	drawLabel(context, item.label, textX, y + 38, {
		font: `14px ${fontStack}`,
		color: muted,
	});
};

const drawLegend = (
	context: SKRSContext2D,
	series: ProbabilitySeries[],
	x: number,
	y: number,
	maxWidth: number,
): void => {
	const columns = series.length > 3 ? 2 : Math.max(1, series.length);
	const columnGap = 18;
	const itemWidth = Math.floor(
		(maxWidth - columnGap * (columns - 1)) / columns,
	);
	const rowHeight = 22;

	series.forEach((entry, index) => {
		const column = index % columns;
		const row = Math.floor(index / columns);
		const itemX = x + column * (itemWidth + columnGap);
		const itemY = y + row * rowHeight;

		context.strokeStyle = entry.color;
		context.lineWidth = 3;
		context.beginPath();
		context.moveTo(itemX, itemY + 9);
		context.lineTo(itemX + 18, itemY + 9);
		context.stroke();
		fillCircle(context, itemX + 9, itemY + 9, 4, entry.color);

		const labelX = itemX + 28;
		const labelY = itemY + 14;
		context.font = `700 14px ${fontStack}`;
		const value = formatPercent(entry.latestProbability, 1);
		const valueWidth = context.measureText(value).width;
		const label = truncateToWidth(
			context,
			entry.label,
			Math.max(46, itemWidth - 44 - valueWidth - 8),
		);
		drawLabel(context, label, labelX, labelY, {
			font: `15px ${fontStack}`,
			color: text,
		});
		const labelWidth = context.measureText(label).width;
		drawLabel(context, value, labelX + labelWidth + 8, labelY, {
			font: `700 14px ${fontStack}`,
			color: muted,
		});
	});
};

const getLegendMetrics = (
	series: ProbabilitySeries[],
): {
	columns: number;
	rowCount: number;
} => {
	const columns = series.length > 3 ? 2 : Math.max(1, series.length);
	return {
		columns,
		rowCount: Math.ceil(series.length / columns),
	};
};

const buildCanvas = async (market: MarketWithRelations): Promise<Buffer> => {
	ensurePublicSansLoaded();
	const canvas = createCanvas(width, height);
	const context = canvas.getContext("2d");
	const generatedAt = new Date();
	const model = buildMarketChartModel(market);
	const probabilityDomain = getProbabilityDomain(model.probabilitySeries);

	context.fillStyle = background;
	context.fillRect(0, 0, width, height);

	context.lineWidth = 1;
	context.strokeStyle = border;
	context.strokeRect(28, 28, width - 56, height - 56);

	context.font = `700 34px ${fontStack}`;
	const titleLines = wrapText(context, market.title, 620, 2);

	titleLines.forEach((line, index) => {
		drawLabel(context, line, 68, 74 + index * 40, {
			font: `700 34px ${fontStack}`,
			color: text,
		});
	});

	const titleBlockHeight = 40 * titleLines.length;
	const subtitleY = 58 + titleBlockHeight;
	drawLabel(context, "Market probabilities over time", 68, subtitleY, {
		font: `17px ${fontStack}`,
		color: muted,
	});

	const statsX = 782;
	const statsY = 62;
	await Promise.all(
		model.metadata.map((item, index) =>
			drawMetadataItem(
				context,
				item,
				statsX + (index % 2) * 184,
				statsY + Math.floor(index / 2) * 58,
			),
		),
	);

	const legendX = 68;
	const legendMaxWidth = 560;
	const legendY = subtitleY + 28;
	const legendMetrics = getLegendMetrics(model.probabilitySeries);
	const legendHeight = legendMetrics.rowCount * 22;
	drawLegend(
		context,
		model.probabilitySeries,
		legendX,
		legendY,
		legendMaxWidth,
	);

	const probabilityBounds: ChartBounds = {
		x: 116,
		y: legendY + legendHeight + 24,
		width: 1000,
		height: 272,
	};
	const volumeBounds: ChartBounds = {
		x: probabilityBounds.x,
		y: probabilityBounds.y + probabilityBounds.height + 56,
		width: probabilityBounds.width,
		height: 86,
	};

	drawLabel(
		context,
		"PROBABILITY",
		probabilityBounds.x,
		probabilityBounds.y - 18,
		{
			font: `700 12px ${fontStack}`,
			color: quiet,
		},
	);
	drawLabel(context, "TRADING VOLUME", volumeBounds.x, volumeBounds.y - 18, {
		font: `700 12px ${fontStack}`,
		color: quiet,
	});

	drawProbabilityGrid(context, probabilityBounds, probabilityDomain);
	drawVolumeGrid(context, volumeBounds, model.maxBucketVolume);
	drawLiquidityMarkers(
		context,
		probabilityBounds,
		model.startTime,
		model.endTime,
		model.liquidityMarkers,
	);

	context.strokeStyle = gridStrong;
	context.lineWidth = 1;
	context.beginPath();
	context.moveTo(
		probabilityBounds.x,
		probabilityBounds.y + probabilityBounds.height + 42,
	);
	context.lineTo(
		probabilityBounds.x + probabilityBounds.width,
		probabilityBounds.y + probabilityBounds.height + 42,
	);
	context.stroke();

	model.probabilitySeries.forEach((series) => {
		drawStepSeries(
			context,
			probabilityBounds,
			series,
			model.startTime,
			model.endTime,
			probabilityDomain,
		);
	});
	drawVolumeHistogram(
		context,
		volumeBounds,
		model.volumeBuckets,
		model.maxBucketVolume,
	);
	drawTimeAxis(context, volumeBounds, model.startTime, model.endTime);

	drawLabel(context, `Market ID ${market.id}`, 68, height - 12, {
		font: `13px ${fontStack}`,
		color: quiet,
		baseline: "bottom",
	});
	drawLabel(
		context,
		`Generated ${formatFooterTimestamp(generatedAt)}`,
		width - 68,
		height - 12,
		{
			font: `13px ${fontStack}`,
			color: quiet,
			align: "right",
			baseline: "bottom",
		},
	);

	return canvas.encode("png");
};

export const buildMarketDiagram = async (
	market: MarketWithRelations,
): Promise<DiagramPayload> => {
	const fileName = `market-${market.id}.png`;
	const buffer = await buildCanvas(market);

	return {
		fileName,
		attachment: new AttachmentBuilder(buffer, {
			name: fileName,
		}),
	};
};
