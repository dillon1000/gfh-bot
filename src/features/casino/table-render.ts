import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { CasinoGameKind } from '@prisma/client';

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
} from './custom-ids.js';
import type {
  CasinoTableSummary,
  MultiplayerBlackjackState,
  MultiplayerHoldemState,
  PlayingCard,
} from './types.js';

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

const buildSeatLines = (table: CasinoTableSummary): string[] =>
  table.seats.length === 0
    ? ['No one is seated yet.']
    : table.seats.map((seat) => {
      const stack = table.game === CasinoGameKind.holdem ? ` • stack ${formatMoney(seat.stack)}` : '';
      const sitOut = seat.sitOut ? ' • sitting out' : '';
      return `${seat.seatIndex + 1}. <@${seat.userId}>${stack}${sitOut}`;
    });

const buildBlackjackStateLines = (state: MultiplayerBlackjackState): string[] => [
  `Dealer: ${formatCard(state.dealerCards[0]!)} 🂠`,
  ...state.players.map((player) => {
    const wager = player.doubledDown ? `${formatMoney(player.wager)} (double)` : formatMoney(player.wager);
    const suffix = player.outcome ? ` • ${player.outcome.replaceAll('_', ' ')}` : ` • ${player.status}`;
    return `<@${player.userId}>: ${formatCards(player.cards)} (${player.total}) • wager ${wager}${suffix}`;
  }),
  state.actionDeadlineAt ? `Action deadline: <t:${Math.floor(new Date(state.actionDeadlineAt).getTime() / 1000)}:R>` : 'Action deadline: none',
];

const buildHoldemStateLines = (state: MultiplayerHoldemState): string[] => [
  `Board: ${state.communityCards.length > 0 ? formatCards(state.communityCards) : 'none yet'}`,
  `Pot: ${formatMoney(state.pot)} • Street: ${state.street}`,
  ...state.players.map((player) => {
    const status = player.folded
      ? 'folded'
      : player.allIn
        ? 'all-in'
        : player.seatIndex === state.actingSeatIndex
          ? 'acting'
          : player.lastAction ?? 'waiting';
    const showdown = player.handCategory ? ` • ${player.handCategory}` : '';
    return `<@${player.userId}>: stack ${formatMoney(player.stack)} • committed ${formatMoney(player.totalCommitted)} • ${status}${showdown}`;
  }),
  state.actionDeadlineAt ? `Action deadline: <t:${Math.floor(new Date(state.actionDeadlineAt).getTime() / 1000)}:R>` : 'Action deadline: none',
];

export const buildCasinoTableEmbed = (table: CasinoTableSummary): EmbedBuilder => {
  const stakeLine = table.game === CasinoGameKind.holdem
    ? `Blinds: **${formatMoney(table.smallBlind ?? 0)} / ${formatMoney(table.bigBlind ?? 0)}** • Default buy-in **${formatMoney(table.defaultBuyIn ?? 0)}**`
    : `Base wager: **${formatMoney(table.baseWager ?? 0)}**`;
  const description = [
    `Table ID: \`${table.id}\``,
    `Host: <@${table.hostUserId}>`,
    `Status: **${table.status}**`,
    stakeLine,
    `Seats: **${table.seats.length}/${table.maxSeats}**`,
    '',
    '**Players**',
    ...buildSeatLines(table),
    ...(table.state
      ? [
          '',
          '**Hand State**',
          ...(table.state.kind === 'multiplayer-blackjack'
            ? buildBlackjackStateLines(table.state)
            : buildHoldemStateLines(table.state)),
        ]
      : []),
  ].join('\n');

  return new EmbedBuilder()
    .setTitle(`🎲 ${table.name} • ${gameLabel(table)}`)
    .setColor(table.status === 'closed' ? 0xef4444 : table.state && table.state.completedAt === null ? 0xf59e0b : 0x60a5fa)
    .setDescription(description);
};

export const buildCasinoTableComponents = (
  table: CasinoTableSummary,
): Array<ActionRowBuilder<ButtonBuilder>> => {
  const handInProgress = Boolean(table.state && table.state.completedAt === null);
  const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(casinoTableJoinButtonCustomId(table.id))
      .setLabel('Join')
      .setStyle(ButtonStyle.Success)
      .setDisabled(table.status === 'closed' || handInProgress || table.seats.length >= table.maxSeats),
    new ButtonBuilder()
      .setCustomId(casinoTableLeaveButtonCustomId(table.id))
      .setLabel('Leave')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(table.status === 'closed' || handInProgress),
    new ButtonBuilder()
      .setCustomId(casinoTableStartButtonCustomId(table.id))
      .setLabel(table.state?.completedAt ? 'Next Hand' : 'Start')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(table.status === 'closed' || handInProgress),
    new ButtonBuilder()
      .setCustomId(casinoTablePeekButtonCustomId(table.id))
      .setLabel('My Hand')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(table.status === 'closed' || !table.state),
    new ButtonBuilder()
      .setCustomId(casinoTableCloseButtonCustomId(table.id))
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(table.status === 'closed' || handInProgress),
  );

  if (!handInProgress || !table.state) {
    return [controls];
  }

  if (table.state.kind === 'multiplayer-blackjack') {
    return [
      controls,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(casinoTableBlackjackHitButtonCustomId(table.id))
          .setLabel('Hit')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(casinoTableBlackjackStandButtonCustomId(table.id))
          .setLabel('Stand')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(casinoTableBlackjackDoubleButtonCustomId(table.id))
          .setLabel('Double')
          .setStyle(ButtonStyle.Primary),
      ),
    ];
  }

  return [
    controls,
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(casinoTableHoldemFoldButtonCustomId(table.id))
        .setLabel('Fold')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(casinoTableHoldemCheckButtonCustomId(table.id))
        .setLabel('Check')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(casinoTableHoldemCallButtonCustomId(table.id))
        .setLabel('Call')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(casinoTableHoldemRaiseButtonCustomId(table.id))
        .setLabel('Raise')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
};

export const buildCasinoTableMessage = (
  table: CasinoTableSummary,
): {
  embeds: [EmbedBuilder];
  components: Array<ActionRowBuilder<ButtonBuilder>>;
} => ({
  embeds: [buildCasinoTableEmbed(table)],
  components: buildCasinoTableComponents(table),
});

export const buildCasinoTableListEmbed = (tables: CasinoTableSummary[]): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle('🎲 Multiplayer Casino Tables')
    .setColor(0x60a5fa)
    .setDescription(
      tables.length === 0
        ? 'No multiplayer casino tables are open right now.'
        : tables.map((table) =>
          `\`${table.id}\` • **${table.name}** • ${gameLabel(table)} • ${table.seats.length}/${table.maxSeats} seats • ${table.status}`).join('\n'),
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
