import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';

import { buildFeedbackEmbed } from '../polls/poll-embeds.js';
import {
  casinoBlackjackHitButtonCustomId,
  casinoBlackjackStandButtonCustomId,
  casinoPokerDiscardSelectCustomId,
  casinoPokerDrawButtonCustomId,
} from './custom-ids.js';
import {
  buildCardEmojiName,
  getBlackjackTotal,
} from './card-utils.js';
import type {
  BlackjackRound,
  BlackjackSession,
  CasinoStatsSummary,
  PersistedCasinoRound,
  PlayingCard,
  PokerRound,
  PokerSession,
  RtdRound,
  SlotsSpin,
} from './types.js';

type CasinoRenderOptions = {
  cardEmojiMap?: Map<string, string>;
};

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

const slotEmoji = (symbol: string): string => {
  switch (symbol) {
    case 'Cherry':
      return '🍒';
    case 'Bell':
      return '🔔';
    case 'Bar':
      return '🎰';
    case 'Seven':
      return '7️⃣';
    case 'Wild':
      return '⭐';
    default:
      return symbol;
  }
};

const formatSlotSymbol = (symbol: string): string => `${slotEmoji(symbol)} ${symbol}`;

const formatCard = (
  card: PlayingCard,
  options?: CasinoRenderOptions,
): string => options?.cardEmojiMap?.get(buildCardEmojiName(card)) ?? `${card.rank}${suitEmoji(card.suit)}`;

const formatCards = (
  cards: PlayingCard[],
  options?: CasinoRenderOptions,
): string => cards.map((card) => formatCard(card, options)).join(' ');

const gameLabel = (game: PersistedCasinoRound['game']): string => {
  switch (game) {
    case 'slots':
      return '🎰 Slots';
    case 'blackjack':
      return '♠️ Blackjack';
    case 'poker':
      return '🃏 Poker';
    case 'rtd':
      return '🎲 RTD';
  }
};

const resultLabel = (persisted: PersistedCasinoRound): string =>
  persisted.result === 'win'
    ? 'Win'
    : persisted.result === 'push'
      ? 'Push'
      : 'Loss';

const resultColor = (persisted: PersistedCasinoRound): number =>
  persisted.result === 'win'
    ? 0x57f287
    : persisted.result === 'push'
      ? 0xf59e0b
      : 0xef4444;

const buildRoundSummaryLines = (
  userId: string,
  persisted: PersistedCasinoRound,
): string[] => [
  `<@${userId}> played **${gameLabel(persisted.game)}**.`,
  `Wager: **${formatMoney(persisted.wager)}**`,
  `Payout: **${formatMoney(persisted.payout)}**`,
  `Net: **${persisted.net >= 0 ? '+' : ''}${formatMoney(persisted.net)}**`,
  `Shared bankroll: **${formatMoney(persisted.bankroll)}**`,
];

export const buildCasinoStatusEmbed = (
  title: string,
  description: string,
  color = 0x60a5fa,
): EmbedBuilder => buildFeedbackEmbed(title, description, color);

export const buildCasinoBalanceEmbed = (
  userId: string,
  bankroll: number,
): EmbedBuilder =>
  buildCasinoStatusEmbed(
    '💰 Casino Balance',
    [`Player: <@${userId}>`, `Shared bankroll: **${formatMoney(bankroll)}**`].join('\n'),
  );

export const buildCasinoStatsEmbed = (
  summary: CasinoStatsSummary,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle('📊 Casino Stats')
    .setColor(0x60a5fa)
    .setDescription([
      `User: <@${summary.userId}>`,
      `Shared bankroll: **${formatMoney(summary.bankroll)}**`,
      `Games: **${summary.totals.gamesPlayed}**`,
      `Record: **${summary.totals.wins}W-${summary.totals.losses}L-${summary.totals.pushes}P**`,
      `Tiebreak wins: **${summary.totals.tiebreakWins}**`,
      `Total wagered: **${formatMoney(summary.totals.totalWagered)}**`,
      `Total net: **${summary.totals.totalNet >= 0 ? '+' : ''}${formatMoney(summary.totals.totalNet)}**`,
    ].join('\n'))
    .addFields(
      summary.perGame.length === 0
        ? [{
            name: 'Per Game',
            value: 'No casino rounds recorded yet.',
          }]
        : [{
            name: 'Per Game',
            value: summary.perGame
              .map((entry) =>
                `**${gameLabel(entry.game)}**: ${entry.wins}W-${entry.losses}L-${entry.pushes}P, streak ${entry.currentStreak}/${entry.bestStreak}, net ${entry.totalNet >= 0 ? '+' : ''}${formatMoney(entry.totalNet)}`)
              .join('\n'),
          }],
    );

export const buildSlotsResultEmbed = (
  userId: string,
  persisted: PersistedCasinoRound,
  spin: SlotsSpin,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle(`🎰 Slots ${resultLabel(persisted)}`)
    .setColor(resultColor(persisted))
    .setDescription([
      ...buildRoundSummaryLines(userId, persisted),
      `Reels: **${spin.reels.map(formatSlotSymbol).join(' | ')}**`,
      spin.winningSymbol
        ? `Hit: **${spin.matchCount} ${formatSlotSymbol(spin.winningSymbol)}** for **${spin.multiplier.toFixed(1)}x**`
        : 'No paying line this spin.',
    ].join('\n'))
    .addFields({
      name: 'Paytable',
      value: [
        '🍒 Cherry 3/4/5: 1.5x / 3x / 6x',
        '🔔 Bell 3/4/5: 2x / 5x / 10x',
        '🎰 Bar 3/4/5: 3x / 8x / 16x',
        '7️⃣ Seven 3/4/5: 5x / 15x / 30x',
        '⭐ Wild 3/4/5: 8x / 20x / 50x',
      ].join('\n'),
    });

export const buildRtdResultEmbed = (
  userId: string,
  persisted: PersistedCasinoRound,
  round: RtdRound,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle(`🎲 RTD ${resultLabel(persisted)}`)
    .setColor(resultColor(persisted))
    .setDescription([
      ...buildRoundSummaryLines(userId, persisted),
      ...round.rolls.map((roll, index) =>
        `Roll ${index + 1}: 🎲 player **${roll.player}** vs 🤖 bot **${roll.bot}**`),
    ].join('\n'));

export const buildBlackjackPrompt = (
  userId: string,
  session: BlackjackSession,
  options?: CasinoRenderOptions,
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<ButtonBuilder>];
} => ({
  embeds: [
    new EmbedBuilder()
      .setTitle('♠️ Blackjack In Progress')
      .setColor(0x60a5fa)
      .setDescription([
        `<@${userId}> started a blackjack hand for **${formatMoney(session.wager)}**.`,
        `🧑 Player: **${formatCards(session.playerCards, options)}**`,
        `Player total: **${getBlackjackTotal(session.playerCards)}**`,
        `🤖 Dealer: **${formatCard(session.dealerCards[0]!, options)} 🂠**`,
      ].join('\n')),
  ],
  components: [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(casinoBlackjackHitButtonCustomId(userId))
        .setLabel('Hit')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(casinoBlackjackStandButtonCustomId(userId))
        .setLabel('Stand')
        .setStyle(ButtonStyle.Secondary),
    ),
  ],
});

export const buildBlackjackResultEmbed = (
  userId: string,
  persisted: PersistedCasinoRound,
  round: BlackjackRound,
  options?: CasinoRenderOptions,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle(`♠️ Blackjack ${resultLabel(persisted)}`)
    .setColor(resultColor(persisted))
    .setDescription([
      ...buildRoundSummaryLines(userId, persisted),
      `🧑 Player: **${formatCards(round.playerCards, options)}** (${round.playerTotal})`,
      `🤖 Dealer: **${formatCards(round.dealerCards, options)}** (${round.dealerTotal})`,
      `Outcome: **${round.outcome.replaceAll('_', ' ')}**`,
    ].join('\n'));

export const buildPokerPrompt = (
  userId: string,
  session: PokerSession,
  options?: CasinoRenderOptions,
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<StringSelectMenuBuilder>, ActionRowBuilder<ButtonBuilder>];
} => {
  const selected = new Set(session.selectedDiscardIndexes ?? []);
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('🃏 Poker Draw')
        .setColor(0x60a5fa)
        .setDescription([
          `<@${userId}> started five-card draw for **${formatMoney(session.wager)}**.`,
          'Choose up to 3 cards to discard, then press Draw.',
          `Your hand: ${session.playerCards.map((card, index) => `${index + 1}:${formatCard(card, options)}${selected.has(index) ? ' ⭐' : ''}`).join('  ')}`,
          `Bot hand: **🂠 🂠 🂠 🂠 🂠**`,
          selected.size > 0
            ? `Selected discards: **${[...selected].map((index) => index + 1).join(', ')}**`
            : 'Selected discards: **none**',
        ].join('\n')),
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(casinoPokerDiscardSelectCustomId(userId))
          .setPlaceholder('Choose up to 3 cards to discard')
          .setMinValues(0)
          .setMaxValues(3)
          .addOptions(session.playerCards.map((card, index) => ({
            label: `Card ${index + 1}: ${card.rank}${suitEmoji(card.suit)}`,
            value: String(index),
            default: selected.has(index),
          }))),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(casinoPokerDrawButtonCustomId(userId))
          .setLabel('Draw')
          .setStyle(ButtonStyle.Success),
      ),
    ],
  };
};

export const buildPokerResultEmbed = (
  userId: string,
  persisted: PersistedCasinoRound,
  round: PokerRound,
  options?: CasinoRenderOptions,
): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle(`🃏 Poker ${resultLabel(persisted)}`)
    .setColor(resultColor(persisted))
    .setDescription([
      ...buildRoundSummaryLines(userId, persisted),
      `🧑 Player: **${formatCards(round.playerCards, options)}** (${round.playerCategory})`,
      `🤖 Bot: **${formatCards(round.botCards, options)}** (${round.botCategory})`,
      `Discarded: **${round.discardedIndexes.length > 0 ? round.discardedIndexes.map((index) => index + 1).join(', ') : 'none'}**`,
      round.bonusMultiplier > 0 ? `Bonus: **+${round.bonusMultiplier.toFixed(1)}x**` : 'Bonus: **none**',
      round.tiebreakDraws.length > 0
        ? `Tiebreak: ${round.tiebreakDraws.map((draw) => `${formatCard(draw.player, options)} vs ${formatCard(draw.bot, options)}`).join(', ')}`
        : 'Tiebreak: none',
    ].join('\n'));
