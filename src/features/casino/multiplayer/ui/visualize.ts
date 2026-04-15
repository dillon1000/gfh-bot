import { AttachmentBuilder } from "discord.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createCanvas,
	loadImage,
	type Image,
	type SKRSContext2D,
} from "@napi-rs/canvas";

import type {
	CasinoTableSeatSummary,
	CasinoTableSummary,
	MultiplayerBlackjackState,
	MultiplayerHoldemState,
	PlayingCard,
} from "../../core/types.js";

const width = 1200;
const height = 760;
const text = "#f6f1e8";
const muted = "#d3ccbe";
const quiet = "#8e98a5";
const border = "#59606c";
const gold = "#e4b058";
const active = "#ffbe55";
const success = "#68d89c";
const danger = "#de7b7b";
const centerShiftY = 42;

type LoadedImage = Awaited<ReturnType<typeof loadImage>>;

export const resolveCardTableAssetPath = (
	relativePath: string,
	moduleUrl: string = import.meta.url,
): string => {
	const candidates = [
		resolve(process.cwd(), "assets", "cardtableAssets", relativePath),
		fileURLToPath(
			new URL(
				`../../../../../assets/cardtableAssets/${relativePath}`,
				moduleUrl,
			),
		),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return candidates[0]!;
};

const assetPath = (relativePath: string): string =>
	resolveCardTableAssetPath(relativePath);

const feltTablePath = assetPath("feltTable.jpg");
const roundTableIconPath = assetPath("icons/round-table.png");
const coinsIconPath = assetPath("icons/coins.png");
const playerBaseIconPath = assetPath("icons/player-base.png");
const playerTimeIconPath = assetPath("icons/player-time.png");

const imageCache = new Map<string, Promise<LoadedImage>>();

type DiagramPayload = {
	attachment: AttachmentBuilder;
	fileName: string;
};

type SeatVisual = {
	title: string;
	stackLine: string;
	potLine: string;
	status: string;
	accent: string;
	dealer: boolean;
	acting: boolean;
	showCardBacks: boolean;
};

const seatPositions = [
	{ x: 600, y: 116 },
	{ x: 938, y: 230 },
	{ x: 938, y: 530 },
	{ x: 600, y: 644 },
	{ x: 262, y: 530 },
	{ x: 262, y: 230 },
];

const formatMoney = (value: number): string => `${value.toFixed(2)} pts`;

const formatStreet = (street: MultiplayerHoldemState["street"]): string =>
	street.charAt(0).toUpperCase() + street.slice(1);

const describeStreet = (street: MultiplayerHoldemState["street"]): string => {
	switch (street) {
		case "preflop":
			return "Pre-flop (no community cards yet)";
		case "flop":
			return "Flop (3 community cards)";
		case "turn":
			return "Turn (4 community cards)";
		case "river":
			return "River (5 community cards)";
		case "showdown":
			return "Showdown";
		case "complete":
			return "Hand complete";
	}
};

const formatSeatName = (
	table: CasinoTableSummary,
	seat: CasinoTableSeatSummary,
): string => {
	if (seat.isBot) {
		return seat.botName ?? `Bot ${seat.seatIndex + 1}`;
	}

	return seat.userId === table.hostUserId
		? `Host Seat ${seat.seatIndex + 1}`
		: `Seat ${seat.seatIndex + 1}`;
};

const cardAssetPath = (card: PlayingCard): string => {
	const rank =
		card.rank === "A"
			? "ace"
			: card.rank === "K"
				? "king"
				: card.rank === "Q"
					? "queen"
					: card.rank === "J"
						? "jack"
						: card.rank.toLowerCase();
	return assetPath(`cards/card-${rank}-${card.suit}.png`);
};

const drawRoundedRect = (
	context: SKRSContext2D,
	x: number,
	y: number,
	rectWidth: number,
	rectHeight: number,
	radius: number,
): void => {
	const clamped = Math.min(radius, rectWidth / 2, rectHeight / 2);
	context.beginPath();
	context.moveTo(x + clamped, y);
	context.lineTo(x + rectWidth - clamped, y);
	context.arcTo(x + rectWidth, y, x + rectWidth, y + clamped, clamped);
	context.lineTo(x + rectWidth, y + rectHeight - clamped);
	context.arcTo(
		x + rectWidth,
		y + rectHeight,
		x + rectWidth - clamped,
		y + rectHeight,
		clamped,
	);
	context.lineTo(x + clamped, y + rectHeight);
	context.arcTo(x, y + rectHeight, x, y + rectHeight - clamped, clamped);
	context.lineTo(x, y + clamped);
	context.arcTo(x, y, x + clamped, y, clamped);
	context.closePath();
};

const loadCachedImage = (file: string): Promise<LoadedImage> => {
	const cached = imageCache.get(file);
	if (cached) {
		return cached;
	}

	const pending = readFile(file).then((buffer) => loadImage(buffer));
	imageCache.set(file, pending);
	return pending;
};

const createTintedIcon = async (file: string, size: number, tint: string) => {
	const icon = await loadCachedImage(file);
	const canvas = createCanvas(size, size);
	const context = canvas.getContext("2d");
	context.drawImage(icon, 0, 0, size, size);
	context.globalCompositeOperation = "source-in";
	context.fillStyle = tint;
	context.fillRect(0, 0, size, size);
	context.globalCompositeOperation = "source-over";
	return canvas;
};

type RenderCanvas = Awaited<ReturnType<typeof createTintedIcon>>;

const tintedIconCache = new Map<string, Promise<RenderCanvas>>();

const loadTintedIcon = async (
	file: string,
	size: number,
	tint: string,
): Promise<RenderCanvas> => {
	const cacheKey = `${file}:${size}:${tint}`;
	const cached = tintedIconCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const pending = createTintedIcon(file, size, tint);

	tintedIconCache.set(cacheKey, pending);
	return pending;
};

const buildSeatVisual = (
	table: CasinoTableSummary,
	state: MultiplayerHoldemState | null,
	seat: CasinoTableSeatSummary,
): SeatVisual => {
	if (!state) {
		return {
			title: formatSeatName(table, seat),
			stackLine: `Stack ${formatMoney(seat.stack)}`,
			potLine: "Not in hand",
			status: seat.sitOut ? "Sitting out" : "Ready",
			accent: seat.sitOut ? quiet : success,
			dealer: false,
			acting: false,
			showCardBacks: false,
		};
	}

	const player = state.players.find(
		(entry) => entry.seatIndex === seat.seatIndex,
	);
	if (!player) {
		return {
			title: formatSeatName(table, seat),
			stackLine: `Stack ${formatMoney(seat.stack)}`,
			potLine: "Between hands",
			status: "Between hands",
			accent: quiet,
			dealer: state.dealerSeatIndex === seat.seatIndex,
			acting: false,
			showCardBacks: false,
		};
	}

	const acting =
		state.completedAt === null && state.actingSeatIndex === seat.seatIndex;
	const payout = player.payout ?? 0;
	const status =
		payout > 0
			? `Won ${formatMoney(payout)}`
			: player.folded
				? "Folded"
				: player.allIn
					? "All-in"
					: acting
						? "To act"
						: player.lastAction === "small_blind"
							? "Small blind"
							: player.lastAction === "big_blind"
								? "Big blind"
								: player.lastAction === "all_in"
									? "All-in"
									: player.lastAction
										? player.lastAction.charAt(0).toUpperCase() +
											player.lastAction.slice(1)
										: "Waiting";
	const accent =
		payout > 0
			? success
			: player.folded
				? danger
				: acting
					? active
					: player.allIn
						? gold
						: border;

	return {
		title: formatSeatName(table, seat),
		stackLine: `Stack ${formatMoney(player.stack)}`,
		potLine: `In pot ${formatMoney(player.totalCommitted)}`,
		status,
		accent,
		dealer: state.dealerSeatIndex === seat.seatIndex,
		acting,
		showCardBacks: !player.folded,
	};
};

const buildCenterCopy = (
	table: CasinoTableSummary,
	state: MultiplayerHoldemState | null,
): string[] => {
	if (!state) {
		const seatedCount = table.seats.filter(
			(seat) => seat.status === "seated",
		).length;
		const needed = Math.max(0, table.minSeats - seatedCount);
		return [
			"Lobby open",
			`${seatedCount}/${table.maxSeats} seated`,
			needed > 0 ? `${needed} more needed to start` : "Ready to deal",
		];
	}

	const actingPlayer =
		state.players.find(
			(player) => player.seatIndex === state.actingSeatIndex,
		) ?? null;
	const actingSeat = actingPlayer
		? (table.seats.find((seat) => seat.seatIndex === actingPlayer.seatIndex) ??
			null)
		: null;
	const amountToCall = actingPlayer
		? Math.max(
				0,
				Number((state.currentBet - actingPlayer.committedThisRound).toFixed(2)),
			)
		: 0;

	return [
		describeStreet(state.street),
		actingSeat
			? `${formatSeatName(table, actingSeat)} to act${amountToCall > 0 ? `: call ${formatMoney(amountToCall)}` : ": check is available"}`
			: state.completedAt
				? "Hand complete"
				: "Resolving hand",
		state.actionDeadlineAt
			? `${Math.max(0, Math.ceil((new Date(state.actionDeadlineAt).getTime() - Date.now()) / 1000))} seconds left`
			: "Action clock paused",
		`Pot ${formatMoney(state.pot)}`,
	];
};

const drawLabel = (
	context: SKRSContext2D,
	label: string,
	x: number,
	y: number,
	options: {
		font: string;
		color: string;
		align?: CanvasTextAlign;
	},
): void => {
	context.font = options.font;
	context.fillStyle = options.color;
	context.textAlign = options.align ?? "left";
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

const drawImageContain = (
	context: SKRSContext2D,
	image: Image | RenderCanvas,
	x: number,
	y: number,
	targetWidth: number,
	targetHeight: number,
): void => {
	const scale = Math.min(
		targetWidth / image.width,
		targetHeight / image.height,
	);
	const drawWidth = image.width * scale;
	const drawHeight = image.height * scale;
	const offsetX = x + (targetWidth - drawWidth) / 2;
	const offsetY = y + (targetHeight - drawHeight) / 2;
	context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
};

const drawSeatPanel = (
	context: SKRSContext2D,
	table: CasinoTableSummary,
	state: MultiplayerHoldemState | null,
	seatIndex: number,
	playerBaseIcon: RenderCanvas,
	playerTimeIcon: RenderCanvas,
): void => {
	const seat =
		table.seats.find(
			(entry) => entry.status === "seated" && entry.seatIndex === seatIndex,
		) ?? null;
	const position = seatPositions[seatIndex] ?? { x: 0, y: 0 };
	const boxX = position.x - 118;
	const boxY = position.y - 58;

	context.save();
	if (!seat) {
		drawRoundedRect(context, boxX, boxY, 212, 100, 26);
		context.fillStyle = "rgba(12, 14, 20, 0.78)";
		context.fill();
		context.setLineDash([8, 8]);
		context.lineWidth = 2;
		context.strokeStyle = border;
		context.stroke();
		context.setLineDash([]);
		drawLabel(context, "Open seat", position.x, position.y - 2, {
			font: "700 19px sans-serif",
			color: muted,
			align: "center",
		});
		drawLabel(context, `Seat ${seatIndex + 1}`, position.x, position.y + 24, {
			font: "15px sans-serif",
			color: quiet,
			align: "center",
		});
		context.restore();
		return;
	}

	const visual = buildSeatVisual(table, state, seat);
	drawRoundedRect(context, boxX, boxY, 236, 116, 26);
	context.fillStyle = "rgba(12, 14, 20, 0.82)";
	context.fill();
	context.lineWidth = visual.acting ? 3 : 2;
	context.strokeStyle = visual.accent;
	context.stroke();
	context.drawImage(
		visual.acting ? playerTimeIcon : playerBaseIcon,
		boxX + 12,
		boxY + 10,
		34,
		34,
	);
	context.font = "700 19px sans-serif";
	drawLabel(
		context,
		truncateToWidth(context, visual.title, 112),
		boxX + 52,
		boxY + 31,
		{
			font: "700 19px sans-serif",
			color: text,
		},
	);
	drawLabel(context, visual.stackLine, boxX + 20, boxY + 58, {
		font: "14px sans-serif",
		color: muted,
	});
	drawLabel(context, visual.potLine, boxX + 20, boxY + 78, {
		font: "14px sans-serif",
		color: muted,
	});
	drawLabel(context, visual.status, boxX + 20, boxY + 100, {
		font: "700 15px sans-serif",
		color: visual.accent,
	});

	if (visual.dealer) {
		drawRoundedRect(context, boxX + 164, boxY + 12, 58, 24, 12);
		context.fillStyle = gold;
		context.fill();
		drawLabel(context, "Dealer", boxX + 193, boxY + 29, {
			font: "700 12px sans-serif",
			color: "#241c12",
			align: "center",
		});
	}

	if (visual.acting) {
		drawRoundedRect(context, boxX + 170, boxY + 88, 46, 22, 11);
		context.fillStyle = active;
		context.fill();
		drawLabel(context, "Turn", boxX + 193, boxY + 103, {
			font: "700 12px sans-serif",
			color: "#36230f",
			align: "center",
		});
	}

	if (visual.showCardBacks) {
		drawRoundedRect(context, position.x - 30, boxY + 120, 30, 44, 8);
		context.fillStyle = "#305db6";
		context.fill();
		context.lineWidth = 2;
		context.strokeStyle = "#89aef1";
		context.stroke();
		drawRoundedRect(context, position.x - 6, boxY + 124, 30, 44, 8);
		context.fillStyle = "#305db6";
		context.fill();
		context.strokeStyle = "#89aef1";
		context.stroke();
	}
	context.restore();
};

const buildBlackjackSeatVisual = (
	table: CasinoTableSummary,
	state: MultiplayerBlackjackState | null,
	seat: CasinoTableSeatSummary,
): SeatVisual => {
	if (!state) {
		return {
			title: formatSeatName(table, seat),
			stackLine: `Wager ${formatMoney(table.baseWager ?? 0)}`,
			potLine: "Waiting to start",
			status: seat.sitOut ? "Sitting out" : "Ready",
			accent: seat.sitOut ? quiet : success,
			dealer: false,
			acting: false,
			showCardBacks: false,
		};
	}

	const player = state.players.find(
		(entry) => entry.seatIndex === seat.seatIndex,
	);
	if (!player) {
		return {
			title: formatSeatName(table, seat),
			stackLine: `Wager ${formatMoney(table.baseWager ?? 0)}`,
			potLine: "Watching",
			status: "Between rounds",
			accent: quiet,
			dealer: false,
			acting: false,
			showCardBacks: false,
		};
	}

	const acting =
		state.completedAt === null && state.actingSeatIndex === seat.seatIndex;
	const status = player.outcome
		? player.outcome.replaceAll("_", " ")
		: acting
			? "To act"
			: player.status;
	const accent =
		player.outcome === "player_win" || player.outcome === "blackjack"
			? success
			: player.outcome === "dealer_win" || player.outcome === "player_bust"
				? danger
				: acting
					? active
					: player.doubledDown
						? gold
						: border;

	return {
		title: formatSeatName(table, seat),
		stackLine: `Wager ${formatMoney(player.wager)}`,
		potLine: `Total ${player.total}`,
		status: status.charAt(0).toUpperCase() + status.slice(1),
		accent,
		dealer: false,
		acting,
		showCardBacks: false,
	};
};

const drawCardBack = (
	context: SKRSContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
): void => {
	drawRoundedRect(context, x, y, width, height, 10);
	context.fillStyle = "#305db6";
	context.fill();
	context.lineWidth = 2;
	context.strokeStyle = "#89aef1";
	context.stroke();
};

const drawBlackjackHand = (
	context: SKRSContext2D,
	cards: Array<PlayingCard | null>,
	cardImages: Map<string, Awaited<ReturnType<typeof loadImage>>>,
	centerX: number,
	y: number,
	cardWidth: number,
	cardHeight: number,
): void => {
	const overlap = Math.round(cardWidth * 0.28);
	const totalWidth =
		cards.length === 0
			? 0
			: cardWidth + (cards.length - 1) * (cardWidth - overlap);
	let x = centerX - totalWidth / 2;
	for (const card of cards) {
		if (card) {
			const image = cardImages.get(cardAssetPath(card));
			if (image) {
				drawImageContain(context, image, x, y, cardWidth, cardHeight);
			}
		} else {
			drawCardBack(context, x, y, cardWidth, cardHeight);
		}
		x += cardWidth - overlap;
	}
};

const getBlackjackSeatHandPosition = (
	seatIndex: number,
	position: { x: number; y: number },
	boxY: number,
): { centerX: number; y: number } => {
	switch (seatIndex) {
		case 0:
			return { centerX: position.x - 154, y: boxY + 18 };
		case 1:
			return { centerX: position.x - 34, y: boxY + 126 };
		case 2:
			return { centerX: position.x - 34, y: boxY + 126 };
		case 3:
			return { centerX: position.x, y: boxY - 62 };
		case 4:
			return { centerX: position.x + 34, y: boxY + 126 };
		case 5:
			return { centerX: position.x + 34, y: boxY + 126 };
		default:
			return { centerX: position.x, y: boxY + 124 };
	}
};

const drawBlackjackSeatPanel = (
	context: SKRSContext2D,
	table: CasinoTableSummary,
	state: MultiplayerBlackjackState | null,
	seatIndex: number,
	playerBaseIcon: RenderCanvas,
	playerTimeIcon: RenderCanvas,
	cardImages: Map<string, LoadedImage>,
): void => {
	const seat =
		table.seats.find(
			(entry) => entry.status === "seated" && entry.seatIndex === seatIndex,
		) ?? null;
	const position = seatPositions[seatIndex] ?? { x: 0, y: 0 };
	const boxX = position.x - 118;
	const boxY = position.y - 58;

	context.save();
	if (!seat) {
		drawRoundedRect(context, boxX, boxY, 212, 100, 26);
		context.fillStyle = "rgba(12, 14, 20, 0.78)";
		context.fill();
		context.setLineDash([8, 8]);
		context.lineWidth = 2;
		context.strokeStyle = border;
		context.stroke();
		context.setLineDash([]);
		drawLabel(context, "Open seat", position.x, position.y - 2, {
			font: "700 19px sans-serif",
			color: muted,
			align: "center",
		});
		drawLabel(context, `Seat ${seatIndex + 1}`, position.x, position.y + 24, {
			font: "15px sans-serif",
			color: quiet,
			align: "center",
		});
		context.restore();
		return;
	}

	const visual = buildBlackjackSeatVisual(table, state, seat);
	drawRoundedRect(context, boxX, boxY, 236, 116, 26);
	context.fillStyle = "rgba(12, 14, 20, 0.82)";
	context.fill();
	context.lineWidth = visual.acting ? 3 : 2;
	context.strokeStyle = visual.accent;
	context.stroke();
	context.drawImage(
		visual.acting ? playerTimeIcon : playerBaseIcon,
		boxX + 12,
		boxY + 10,
		34,
		34,
	);
	context.font = "700 19px sans-serif";
	drawLabel(
		context,
		truncateToWidth(context, visual.title, 112),
		boxX + 52,
		boxY + 31,
		{
			font: "700 19px sans-serif",
			color: text,
		},
	);
	drawLabel(context, visual.stackLine, boxX + 20, boxY + 58, {
		font: "14px sans-serif",
		color: muted,
	});
	drawLabel(context, visual.potLine, boxX + 20, boxY + 78, {
		font: "14px sans-serif",
		color: muted,
	});
	drawLabel(context, visual.status, boxX + 20, boxY + 100, {
		font: "700 15px sans-serif",
		color: visual.accent,
	});

	if (visual.acting) {
		drawRoundedRect(context, boxX + 170, boxY + 88, 46, 22, 11);
		context.fillStyle = active;
		context.fill();
		drawLabel(context, "Turn", boxX + 193, boxY + 103, {
			font: "700 12px sans-serif",
			color: "#36230f",
			align: "center",
		});
	}

	if (state) {
		const player = state.players.find((entry) => entry.seatIndex === seatIndex);
		if (player) {
			const handPosition = getBlackjackSeatHandPosition(
				seatIndex,
				position,
				boxY,
			);
			const cardWidth = seatIndex === 0 ? 30 : 36;
			const cardHeight = seatIndex === 0 ? 44 : 52;
			drawBlackjackHand(
				context,
				player.cards,
				cardImages,
				handPosition.centerX,
				handPosition.y,
				cardWidth,
				cardHeight,
			);
		}
	}

	context.restore();
};

const buildBlackjackCenterCopy = (
	table: CasinoTableSummary,
	state: MultiplayerBlackjackState | null,
): string[] => {
	if (!state) {
		const seatedCount = table.seats.filter(
			(seat) => seat.status === "seated",
		).length;
		return [
			"Blackjack lobby",
			seatedCount >= table.minSeats
				? "Ready to deal"
				: "Waiting for more players",
			`Base wager ${formatMoney(table.baseWager ?? 0)}`,
		];
	}

	const actingSeat =
		state.actingSeatIndex === null
			? null
			: (table.seats.find((seat) => seat.seatIndex === state.actingSeatIndex) ??
				null);
	return [
		state.completedAt ? "Round complete" : "Blackjack round in progress",
		actingSeat
			? `${formatSeatName(table, actingSeat)} to act`
			: "Dealer resolving",
		state.actionDeadlineAt
			? `${Math.max(0, Math.ceil((new Date(state.actionDeadlineAt).getTime() - Date.now()) / 1000))} seconds left`
			: "Action clock paused",
	];
};

export const buildHoldemTableDiagram = async (
	table: CasinoTableSummary,
): Promise<DiagramPayload> => {
	const state = table.state?.kind === "multiplayer-holdem" ? table.state : null;
	const canvas = createCanvas(width, height);
	const context = canvas.getContext("2d");

	const [
		feltTable,
		roundTableIcon,
		coinsIcon,
		playerBaseIcon,
		playerTimeIcon,
		...communityCardImages
	] = await Promise.all([
		loadCachedImage(feltTablePath),
		loadCachedImage(roundTableIconPath),
		loadCachedImage(coinsIconPath),
		loadTintedIcon(playerBaseIconPath, 34, text),
		loadTintedIcon(playerTimeIconPath, 34, active),
		...(state?.communityCards ?? []).map((card) =>
			loadCachedImage(cardAssetPath(card)),
		),
	]);

	context.drawImage(feltTable, 0, 0, width, height);

	const topFade = context.createLinearGradient(0, 0, 0, 170);
	topFade.addColorStop(0, "rgba(9, 10, 14, 0.84)");
	topFade.addColorStop(1, "rgba(9, 10, 14, 0.12)");
	context.fillStyle = topFade;
	context.fillRect(0, 0, width, 170);

	const bottomFade = context.createLinearGradient(0, height, 0, height - 170);
	bottomFade.addColorStop(0, "rgba(9, 10, 14, 0.74)");
	bottomFade.addColorStop(1, "rgba(9, 10, 14, 0.10)");
	context.fillStyle = bottomFade;
	context.fillRect(0, height - 170, width, 170);

	context.save();
	context.globalAlpha = 0.18;
	drawImageContain(context, roundTableIcon, 360, 138, 480, 480);
	context.restore();

	context.beginPath();
	context.ellipse(600, 380, 358, 214, 0, 0, Math.PI * 2);
	context.fillStyle = "rgba(8, 17, 14, 0.34)";
	context.fill();
	context.lineWidth = 4;
	context.strokeStyle = "rgba(228, 176, 88, 0.68)";
	context.stroke();

	context.beginPath();
	context.ellipse(600, 380, 322, 178, 0, 0, Math.PI * 2);
	context.strokeStyle = "rgba(228, 176, 88, 0.22)";
	context.lineWidth = 2;
	context.stroke();

	for (let index = 0; index < 5; index += 1) {
		const x = 368 + index * 96;
		drawRoundedRect(context, x, 276 + centerShiftY, 88, 122, 16);
		context.fillStyle = "rgba(17, 20, 24, 0.28)";
		context.fill();
		context.setLineDash([8, 8]);
		context.lineWidth = 2;
		context.strokeStyle = "rgba(239, 242, 244, 0.22)";
		context.stroke();
		context.setLineDash([]);
	}

	communityCardImages.forEach((cardImage, index) => {
		drawImageContain(
			context,
			cardImage,
			368 + index * 96,
			276 + centerShiftY,
			88,
			122,
		);
	});

	const centerCopy = buildCenterCopy(table, state);
	drawRoundedRect(context, 396, 176 + centerShiftY, 408, 108, 22);
	context.fillStyle = "rgba(10, 13, 18, 0.68)";
	context.fill();
	context.lineWidth = 2;
	context.strokeStyle = "rgba(228, 176, 88, 0.28)";
	context.stroke();
	drawImageContain(context, coinsIcon, 532, 470 + centerShiftY, 76, 76);
	drawLabel(context, table.name, 70, 66, {
		font: "700 34px sans-serif",
		color: text,
	});
	drawLabel(context, "Texas Hold'em table view", 70, 98, {
		font: "18px sans-serif",
		color: muted,
	});
	drawLabel(
		context,
		table.status === "closed"
			? "Closed"
			: state?.completedAt === null
				? `Hand #${state.handNumber}`
				: state
					? `Hand #${state.handNumber} complete`
					: "Lobby",
		1130,
		66,
		{
			font: "700 18px sans-serif",
			color: gold,
			align: "right",
		},
	);
	drawLabel(context, "Current turn", 600, 204 + centerShiftY, {
		font: "700 15px sans-serif",
		color: gold,
		align: "center",
	});
	drawLabel(context, centerCopy[0] ?? "", 600, 232 + centerShiftY, {
		font: "700 24px sans-serif",
		color: text,
		align: "center",
	});
	drawLabel(context, centerCopy[1] ?? "", 600, 258 + centerShiftY, {
		font: "700 22px sans-serif",
		color: text,
		align: "center",
	});
	drawLabel(context, centerCopy[2] ?? "", 510, 278 + centerShiftY, {
		font: "700 17px sans-serif",
		color: active,
		align: "center",
	});
	drawLabel(context, centerCopy[3] ?? "", 690, 278 + centerShiftY, {
		font: "700 17px sans-serif",
		color: text,
		align: "center",
	});
	drawLabel(
		context,
		`Blinds ${formatMoney(table.smallBlind ?? 0)} / ${formatMoney(table.bigBlind ?? 0)}`,
		600,
		430 + centerShiftY,
		{
			font: "700 20px sans-serif",
			color: text,
			align: "center",
		},
	);
	drawLabel(
		context,
		`Buy-in ${formatMoney(table.defaultBuyIn ?? 0)}`,
		600,
		454 + centerShiftY,
		{
			font: "16px sans-serif",
			color: muted,
			align: "center",
		},
	);

	for (let seatIndex = 0; seatIndex < table.maxSeats; seatIndex += 1) {
		drawSeatPanel(
			context,
			table,
			state,
			seatIndex,
			playerBaseIcon,
			playerTimeIcon,
		);
	}

	const fileName = `casino-holdem-${table.id}.png`;
	return {
		fileName,
		attachment: new AttachmentBuilder(await canvas.encode("png"), {
			name: fileName,
		}),
	};
};

export const buildBlackjackTableDiagram = async (
	table: CasinoTableSummary,
): Promise<DiagramPayload> => {
	const state =
		table.state?.kind === "multiplayer-blackjack" ? table.state : null;
	const canvas = createCanvas(width, height);
	const context = canvas.getContext("2d");

	const allCards = [
		...(state?.dealerCards ?? []),
		...(state?.players ?? []).flatMap((player) => player.cards),
	];
	const uniqueCardPaths = [...new Set(allCards.map(cardAssetPath))];
	const [
		feltTable,
		roundTableIcon,
		coinsIcon,
		playerBaseIcon,
		playerTimeIcon,
		...loadedCardImages
	] = await Promise.all([
		loadCachedImage(feltTablePath),
		loadCachedImage(roundTableIconPath),
		loadCachedImage(coinsIconPath),
		loadTintedIcon(playerBaseIconPath, 34, text),
		loadTintedIcon(playerTimeIconPath, 34, active),
		...uniqueCardPaths.map((path) => loadCachedImage(path)),
	]);
	const cardImages = new Map(
		uniqueCardPaths.map((path, index) => [path, loadedCardImages[index]!]),
	);

	context.drawImage(feltTable, 0, 0, width, height);

	const topFade = context.createLinearGradient(0, 0, 0, 170);
	topFade.addColorStop(0, "rgba(9, 10, 14, 0.84)");
	topFade.addColorStop(1, "rgba(9, 10, 14, 0.12)");
	context.fillStyle = topFade;
	context.fillRect(0, 0, width, 170);

	const bottomFade = context.createLinearGradient(0, height, 0, height - 170);
	bottomFade.addColorStop(0, "rgba(9, 10, 14, 0.74)");
	bottomFade.addColorStop(1, "rgba(9, 10, 14, 0.10)");
	context.fillStyle = bottomFade;
	context.fillRect(0, height - 170, width, 170);

	context.save();
	context.globalAlpha = 0.18;
	drawImageContain(context, roundTableIcon, 360, 138, 480, 480);
	context.restore();

	context.beginPath();
	context.ellipse(600, 390, 358, 214, 0, 0, Math.PI * 2);
	context.fillStyle = "rgba(8, 17, 14, 0.34)";
	context.fill();
	context.lineWidth = 4;
	context.strokeStyle = "rgba(228, 176, 88, 0.68)";
	context.stroke();

	context.beginPath();
	context.ellipse(600, 390, 322, 178, 0, 0, Math.PI * 2);
	context.strokeStyle = "rgba(228, 176, 88, 0.22)";
	context.lineWidth = 2;
	context.stroke();

	const dealerCards = !state
		? []
		: state.completedAt === null
			? [state.dealerCards[0] ?? null, null]
			: state.dealerCards;
	const centerCopy = buildBlackjackCenterCopy(table, state);
	drawRoundedRect(context, 408, 188, 384, 98, 22);
	context.fillStyle = "rgba(10, 13, 18, 0.68)";
	context.fill();
	context.lineWidth = 2;
	context.strokeStyle = "rgba(228, 176, 88, 0.28)";
	context.stroke();
	drawLabel(context, "Current turn", 600, 214, {
		font: "700 15px sans-serif",
		color: gold,
		align: "center",
	});
	drawLabel(context, centerCopy[0] ?? "", 600, 242, {
		font: "700 22px sans-serif",
		color: text,
		align: "center",
	});
	drawLabel(context, centerCopy[1] ?? "", 600, 268, {
		font: "700 19px sans-serif",
		color: text,
		align: "center",
	});

	drawLabel(context, "Dealer hand", 600, 320, {
		font: "700 15px sans-serif",
		color: gold,
		align: "center",
	});
	if (dealerCards.length > 0) {
		drawBlackjackHand(context, dealerCards, cardImages, 600, 338, 74, 106);
	}

	drawRoundedRect(context, 440, 472, 320, 62, 18);
	context.fillStyle = "rgba(10, 13, 18, 0.58)";
	context.fill();
	context.lineWidth = 1.5;
	context.strokeStyle = "rgba(228, 176, 88, 0.22)";
	context.stroke();
	drawImageContain(context, coinsIcon, 528, 478, 50, 50);
	drawLabel(context, table.name, 70, 66, {
		font: "700 34px sans-serif",
		color: text,
	});
	drawLabel(context, "Blackjack table view", 70, 98, {
		font: "18px sans-serif",
		color: muted,
	});
	drawLabel(
		context,
		table.status === "closed"
			? "Closed"
			: state?.completedAt === null
				? `Hand #${state.handNumber}`
				: state
					? `Hand #${state.handNumber} complete`
					: "Lobby",
		1130,
		66,
		{
			font: "700 18px sans-serif",
			color: gold,
			align: "right",
		},
	);
	drawLabel(context, centerCopy[2] ?? "", 510, 512, {
		font: "700 16px sans-serif",
		color: active,
		align: "center",
	});
	drawLabel(
		context,
		`Base wager ${formatMoney(table.baseWager ?? 0)}`,
		680,
		512,
		{
			font: "700 16px sans-serif",
			color: text,
			align: "center",
		},
	);

	if (state) {
		drawLabel(
			context,
			state.completedAt === null
				? "Dealer hole card hidden until players finish"
				: "Dealer hand revealed",
			600,
			458,
			{
				font: "700 17px sans-serif",
				color: muted,
				align: "center",
			},
		);
	}

	for (let seatIndex = 0; seatIndex < table.maxSeats; seatIndex += 1) {
		drawBlackjackSeatPanel(
			context,
			table,
			state,
			seatIndex,
			playerBaseIcon,
			playerTimeIcon,
			cardImages,
		);
	}

	const fileName = `casino-blackjack-${table.id}.png`;
	return {
		fileName,
		attachment: new AttachmentBuilder(await canvas.encode("png"), {
			name: fileName,
		}),
	};
};
