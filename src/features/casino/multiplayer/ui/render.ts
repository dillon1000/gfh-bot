import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { CasinoGameKind } from '@prisma/client';

import { logger } from '../../../../app/logger.js';
import {
  casinoTableBlackjackDoubleButtonCustomId,
  casinoTableBlackjackHitButtonCustomId,
  casinoTableBlackjackStandButtonCustomId,
  casinoTableCloseButtonCustomId,
  casinoTableHoldemCallButtonCustomId,
  casinoTableHoldemCheckButtonCustomId,
  casinoTableHoldemFoldButtonCustomId,
  casinoTableHoldemRaiseButtonCustomId,
  casinoTableJoinButtonCustomId,
  casinoTableLeaveButtonCustomId,
  casinoTablePeekButtonCustomId,
  casinoTableStartButtonCustomId,
} from '../../ui/custom-ids.js';
import type {
  CasinoTableSeatSummary,
  CasinoTableSummary,
  MultiplayerBlackjackState,
  MultiplayerHoldemState,
  PlayingCard,
} from '../../core/types.js';
import {
  buildBlackjackTableDiagram,
  buildHoldemTableDiagram,
} from './visualize.js';

const formatMoney = (value: number): string => `${value.toFixed(2)} pts`;

const suitEmoji = (suit: PlayingCard['suit']): string => {
  switch (suit) {
    case 'clubs':
      return '♣️';
    case 'diamonds':
      return '♦️';
    case 'hearts':
      return '♥️';
    case 'spades':
      return '♠️';
  }
};

const formatCard = (card: PlayingCard): string => `${card.rank}${suitEmoji(card.suit)}`;

const formatCards = (cards: PlayingCard[]): string => cards.map(formatCard).join(' ');

const gameLabel = (table: CasinoTableSummary): string =>
  table.game === CasinoGameKind.holdem ? 'Texas Hold\'em' : 'Blackjack';

const formatGameStatus = (table: CasinoTableSummary): string => {
  if (table.status === 'closed') {
    return 'Closed';
  }

  if (table.state?.completedAt === null) {
    return `Hand #${table.state.handNumber} live`;
  }

  if (table.state?.completedAt) {
    return `Hand #${table.state.handNumber} complete`;
  }

  return 'Lobby open';
};

const formatDeadline = (deadlineAt: string | Date | null): string =>
  deadlineAt
    ? `<t:${Math.floor(new Date(deadlineAt).getTime() / 1000)}:R>`
    : 'none';

const formatSeatActor = (table: CasinoTableSummary, userId: string): string => {
  const seat = table.seats.find((entry) => entry.userId === userId);
  if (seat?.isBot) {
    return `${seat.botName ?? 'Bot'} [bot]`;
  }

  return `<@${userId}>`;
};

const formatSeatShortLabel = (table: CasinoTableSummary, seat: CasinoTableSeatSummary): string => {
  const actor = formatSeatActor(table, seat.userId);
  return seat.userId === table.hostUserId
    ? `${actor} (host)`
    : actor;
};

const humanizeHoldemAction = (action: MultiplayerHoldemState['players'][number]['lastAction']): string => {
  switch (action) {
    case 'small_blind':
      return 'small blind';
    case 'big_blind':
      return 'big blind';
    case 'all_in':
      return 'all-in';
    case null:
      return 'waiting';
    default:
      return action;
  }
};

const buildSeatLines = (table: CasinoTableSummary): string[] => {
  const seated = table.seats.filter((seat) => seat.status === 'seated');
  if (seated.length === 0) {
    return ['No one is seated yet.'];
  }

  if (table.state?.kind === 'multiplayer-holdem') {
    const playerBySeatIndex = new Map(table.state.players.map((player) => [player.seatIndex, player]));
    return seated.map((seat) => {
      const player = playerBySeatIndex.get(seat.seatIndex);
      const status = !player
        ? seat.sitOut
          ? 'sitting out'
          : 'waiting'
        : player.folded
          ? 'folded'
          : player.allIn
            ? 'all-in'
            : player.seatIndex === table.state?.actingSeatIndex && table.state.completedAt === null
              ? 'to act'
              : humanizeHoldemAction(player.lastAction);
      const committed = player ? ` • in pot ${formatMoney(player.totalCommitted)}` : '';
      return `${seat.seatIndex + 1}. ${formatSeatShortLabel(table, seat)} • stack ${formatMoney(seat.stack)}${committed} • ${status}`;
    });
  }

  if (table.state?.kind === 'multiplayer-blackjack') {
    const playerBySeatIndex = new Map(table.state.players.map((player) => [player.seatIndex, player]));
    return seated.map((seat) => {
      const player = playerBySeatIndex.get(seat.seatIndex);
      const status = player
        ? player.status === 'acting'
          ? 'to act'
          : player.status
        : seat.sitOut
          ? 'sitting out'
          : 'waiting';
      const wager = player ? ` • wager ${formatMoney(player.wager)}` : '';
      return `${seat.seatIndex + 1}. ${formatSeatShortLabel(table, seat)}${wager} • ${status}`;
    });
  }

  return seated.map((seat) => {
    const stack = table.game === CasinoGameKind.holdem ? ` • stack ${formatMoney(seat.stack)}` : '';
    const sitOut = seat.sitOut ? ' • sitting out' : '';
    return `${seat.seatIndex + 1}. ${formatSeatShortLabel(table, seat)}${stack}${sitOut}`;
  });
};

const buildBlackjackStateLines = (table: CasinoTableSummary, state: MultiplayerBlackjackState): string[] => [
  `Turn: ${state.actingSeatIndex === null ? 'Dealer resolving' : formatSeatActor(table, state.players.find((player) => player.seatIndex === state.actingSeatIndex)?.userId ?? table.hostUserId)}`,
  `Dealer: ${formatCard(state.dealerCards[0]!)} 🂠`,
  ...state.players.map((player) => {
    const wager = player.doubledDown ? `${formatMoney(player.wager)} (double)` : formatMoney(player.wager);
    const suffix = player.outcome ? ` • ${player.outcome.replaceAll('_', ' ')}` : ` • ${player.status === 'acting' ? 'to act' : player.status}`;
    return `${formatSeatActor(table, player.userId)} • ${formatCards(player.cards)} (${player.total}) • wager ${wager}${suffix}`;
  }),
  `Action deadline: ${formatDeadline(state.actionDeadlineAt)}`,
];

const buildHoldemStateLines = (table: CasinoTableSummary, state: MultiplayerHoldemState): string[] => {
  const actingPlayer = state.players.find((player) => player.seatIndex === state.actingSeatIndex) ?? null;
  const amountToCall = actingPlayer
    ? Math.max(0, Number((state.currentBet - actingPlayer.committedThisRound).toFixed(2)))
    : 0;
  const winners = state.completedAt
    ? state.players
      .filter((player) => (player.payout ?? 0) > 0)
      .map((player) => `${formatSeatActor(table, player.userId)} +${formatMoney(player.payout ?? 0)}`)
    : [];

  return [
    `Board: ${state.communityCards.length > 0 ? formatCards(state.communityCards) : 'none yet'}`,
    `Pot: ${formatMoney(state.pot)} • Street: ${state.street} • Bet to match ${formatMoney(state.currentBet)}`,
    actingPlayer
      ? `Turn: ${formatSeatActor(table, actingPlayer.userId)} • ${amountToCall > 0 ? `call ${formatMoney(amountToCall)}` : 'check available'}`
      : state.completedAt
        ? 'Turn: showdown complete'
        : 'Turn: waiting for auto-resolution',
    ...(winners.length > 0 ? [`Winners: ${winners.join(' • ')}`] : []),
    `Action deadline: ${formatDeadline(state.actionDeadlineAt)}`,
  ];
};

const buildOverviewField = (table: CasinoTableSummary): string => {
  const seatedCount = table.seats.filter((seat) => seat.status === 'seated').length;
  const lines = [
    `Game: **${gameLabel(table)}**`,
    `State: **${formatGameStatus(table)}**`,
    table.game === CasinoGameKind.holdem
      ? `Stakes: **${formatMoney(table.smallBlind ?? 0)} / ${formatMoney(table.bigBlind ?? 0)}**`
      : `Base wager: **${formatMoney(table.baseWager ?? 0)}**`,
    table.game === CasinoGameKind.holdem
      ? `Buy-in: **${formatMoney(table.defaultBuyIn ?? 0)}**`
      : `Seats: **${seatedCount}/${table.maxSeats}**`,
  ];

  if (table.game === CasinoGameKind.holdem) {
    lines.push(`Seats: **${seatedCount}/${table.maxSeats}**`);
  }

  return lines.join('\n');
};

const buildDetailsField = (table: CasinoTableSummary): string =>
  [
    `Host: ${table.hostUserId.startsWith('bot:') ? 'Bot' : `<@${table.hostUserId}>`}`,
    `Table ID: \`${table.id}\``,
    table.noHumanDeadlineAt ? `No-human close: <t:${Math.floor(table.noHumanDeadlineAt.getTime() / 1000)}:R>` : null,
    !table.state && table.lobbyExpiresAt ? `Lobby expires: <t:${Math.floor(table.lobbyExpiresAt.getTime() / 1000)}:R>` : null,
  ].filter(Boolean).join('\n');

export const buildCasinoTableEmbed = (table: CasinoTableSummary): EmbedBuilder => {
  const seatedCount = table.seats.filter((seat) => seat.status === 'seated').length;
  const neededToStart = Math.max(0, table.minSeats - seatedCount);
  const summaryBits = [
    `**${gameLabel(table)}**`,
    `**${formatGameStatus(table)}**`,
    table.state?.completedAt === null && table.actionDeadlineAt
      ? `Action clock ${formatDeadline(table.actionDeadlineAt)}`
      : null,
  ].filter(Boolean);
  const liveField = table.state
    ? {
        name: table.state.kind === 'multiplayer-holdem' ? 'Live Hand' : 'Round',
        value: (table.state.kind === 'multiplayer-blackjack'
          ? buildBlackjackStateLines(table, table.state)
          : buildHoldemStateLines(table, table.state)).join('\n'),
        inline: false,
      }
    : {
        name: 'Lobby',
        value: [
          neededToStart > 0
            ? `Need **${neededToStart}** more player${neededToStart === 1 ? '' : 's'} to start.`
            : 'Enough players are seated to start the next hand.',
          table.game === CasinoGameKind.holdem
            ? `Seats buy in for **${formatMoney(table.defaultBuyIn ?? 0)}** by default.`
            : `Every seat wagers **${formatMoney(table.baseWager ?? 0)}** to join the round.`,
        ].join('\n'),
        inline: false,
      };

  return new EmbedBuilder()
    .setTitle(`🎲 ${table.name}`)
    .setColor(table.status === 'closed' ? 0xef4444 : table.state && table.state.completedAt === null ? 0xf59e0b : 0x60a5fa)
    .setDescription(summaryBits.join(' • '))
    .addFields(
      {
        name: 'Overview',
        value: buildOverviewField(table),
        inline: true,
      },
      {
        name: 'Table Details',
        value: buildDetailsField(table),
        inline: true,
      },
      liveField,
      {
        name: 'Seats',
        value: buildSeatLines(table).join('\n'),
        inline: false,
      },
    );
};

export const buildCasinoTableComponents = (
  table: CasinoTableSummary,
): Array<ActionRowBuilder<ButtonBuilder>> => {
  const handInProgress = Boolean(table.state && table.state.completedAt === null);
  const seatedCount = table.seats.filter((seat) => seat.status === 'seated').length;
  const canJoinFromThread = seatedCount < table.maxSeats
    || table.seats.some((seat) => seat.status === 'seated' && seat.isBot);
  const controlButtons: ButtonBuilder[] = [];

  if (!handInProgress && table.status !== 'closed' && canJoinFromThread) {
    controlButtons.push(
      new ButtonBuilder()
        .setCustomId(casinoTableJoinButtonCustomId(table.id))
        .setLabel('Join')
        .setDisabled(false)
        .setStyle(ButtonStyle.Success),
    );
  }

  if (!handInProgress && table.status !== 'closed' && seatedCount > 0) {
    controlButtons.push(
      new ButtonBuilder()
        .setCustomId(casinoTableLeaveButtonCustomId(table.id))
        .setLabel('Leave')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  if (!handInProgress && table.status !== 'closed' && seatedCount >= table.minSeats) {
    controlButtons.push(
      new ButtonBuilder()
        .setCustomId(casinoTableStartButtonCustomId(table.id))
        .setLabel(table.state?.completedAt ? 'Next Hand' : 'Start Hand')
        .setStyle(ButtonStyle.Primary),
    );
  }

  if (table.status !== 'closed' && table.state) {
    controlButtons.push(
      new ButtonBuilder()
        .setCustomId(casinoTablePeekButtonCustomId(table.id))
        .setLabel('My Hand')
        .setStyle(handInProgress ? ButtonStyle.Primary : ButtonStyle.Secondary),
    );
  }

  if (!handInProgress && table.status !== 'closed') {
    controlButtons.push(
      new ButtonBuilder()
        .setCustomId(casinoTableCloseButtonCustomId(table.id))
        .setLabel('Close Table')
        .setStyle(ButtonStyle.Danger),
    );
  }

  const rows: Array<ActionRowBuilder<ButtonBuilder>> = controlButtons.length > 0
    ? [new ActionRowBuilder<ButtonBuilder>().addComponents(...controlButtons)]
    : [];

  if (!handInProgress || !table.state) {
    return rows;
  }

  const activeState = table.state;

  if (activeState.kind === 'multiplayer-blackjack') {
    const actingPlayer = activeState.players.find((player) => player.seatIndex === activeState.actingSeatIndex);
    if (!actingPlayer) {
      return rows;
    }

    const actionButtons = [
      new ButtonBuilder()
        .setCustomId(casinoTableBlackjackHitButtonCustomId(table.id))
        .setLabel('Hit')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(casinoTableBlackjackStandButtonCustomId(table.id))
        .setLabel('Stand')
        .setStyle(ButtonStyle.Secondary),
      ...(actingPlayer.cards.length === 2 && !actingPlayer.doubledDown
        ? [new ButtonBuilder()
          .setCustomId(casinoTableBlackjackDoubleButtonCustomId(table.id))
          .setLabel('Double')
          .setStyle(ButtonStyle.Primary)]
        : []),
    ];
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...actionButtons));
    return rows;
  }

  const actingPlayer = activeState.players.find((player) => player.seatIndex === activeState.actingSeatIndex);
  if (!actingPlayer) {
    return rows;
  }

  const amountToCall = Math.max(0, Number((activeState.currentBet - actingPlayer.committedThisRound).toFixed(2)));
  const minimumTarget = amountToCall > 0
    ? Number((activeState.currentBet + activeState.minRaise).toFixed(2))
    : Number(activeState.minRaise.toFixed(2));
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(casinoTableHoldemFoldButtonCustomId(table.id))
        .setLabel('Fold')
        .setStyle(ButtonStyle.Danger),
      amountToCall > 0
        ? new ButtonBuilder()
          .setCustomId(casinoTableHoldemCallButtonCustomId(table.id))
          .setLabel(`Call ${formatMoney(amountToCall)}`)
          .setStyle(ButtonStyle.Success)
        : new ButtonBuilder()
          .setCustomId(casinoTableHoldemCheckButtonCustomId(table.id))
          .setLabel('Check')
          .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(casinoTableHoldemRaiseButtonCustomId(table.id))
        .setLabel(`${amountToCall > 0 ? 'Raise' : 'Bet'} ${formatMoney(minimumTarget)}`)
        .setStyle(ButtonStyle.Primary),
    ),
  );

  return rows;
};

export const buildCasinoTableMessage = async (
  table: CasinoTableSummary,
  options?: {
    replaceAttachments?: boolean;
  },
): Promise<{
  embeds: [EmbedBuilder];
  components: Array<ActionRowBuilder<ButtonBuilder>>;
  files?: AttachmentBuilder[];
  attachments?: [];
}> => {
  const payload = {
    embeds: [buildCasinoTableEmbed(table)] as [EmbedBuilder],
    components: buildCasinoTableComponents(table),
  };

  try {
    const diagram = table.game === CasinoGameKind.holdem
      ? await buildHoldemTableDiagram(table)
      : await buildBlackjackTableDiagram(table);
    payload.embeds[0].setImage(`attachment://${diagram.fileName}`);
    return {
      ...payload,
      files: [diagram.attachment],
      ...(options?.replaceAttachments ? { attachments: [] as [] } : {}),
    };
  } catch (error) {
    logger.warn({ err: error, tableId: table.id }, 'Could not generate Holdem table diagram');
    return {
      ...payload,
      ...(options?.replaceAttachments ? { attachments: [] as [] } : {}),
    };
  }
};

export const buildCasinoTableListEmbed = (tables: CasinoTableSummary[]): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle('🎲 Multiplayer Casino Tables')
    .setColor(0x60a5fa)
    .setDescription(
      tables.length === 0
        ? 'No multiplayer casino tables are open right now.'
        : tables.map((table) =>
          `\`${table.id}\` • **${table.name}** • ${gameLabel(table)} • ${table.seats.filter((seat) => seat.status === 'seated').length}/${table.maxSeats} seats • ${table.status}`).join('\n'),
    );

export const buildCasinoTablePrivateEmbed = (
  table: CasinoTableSummary,
  cards: PlayingCard[] | null,
  note: string | null,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle(`🃏 Private View • ${table.name}`)
    .setColor(0x60a5fa)
    .setDescription(
      cards
        ? [
            `Your cards: ${formatCards(cards)}`,
            note ?? '',
          ].filter(Boolean).join('\n')
        : 'You are not seated in the current hand.',
    );
