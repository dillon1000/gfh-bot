import {
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { buildLeaderboardEmbed, buildMarketCancelModal, buildMarketListEmbed, buildMarketResolveModal, buildMarketStatusEmbed, buildMarketTradeModal, buildMarketTradeSelector, buildPortfolioMessage } from './render.js';
import { disableMarketConfig, describeMarketConfig, getMarketConfig, setMarketConfig } from './config-service.js';
import { marketPortfolioSelectCustomId } from './custom-ids.js';
import { buildMarketViewResponse, clearMarketLifecycle, hydrateMarketMessage, refreshMarketMessage } from './service-lifecycle.js';
import {
  cancelMarket,
  clearMarketJobs,
  createMarketRecord,
  deleteMarketRecord,
  editMarketRecord,
  executeMarketTrade,
  getMarketAccountSummary,
  getMarketById,
  getMarketByQuery,
  getMarketLeaderboard,
  listMarkets,
  resolveMarket,
  resolveMarketOutcome,
  scheduleMarketClose,
  scheduleMarketRefresh,
} from './service.js';
import {
  parseMarketCloseAt,
  parseMarketOutcomes,
  parseMarketTags,
  parseFlexibleTradeAmount,
  parseOutcomeSelection,
  parseTradeAmount,
  sanitizeMarketDescription,
  sanitizeMarketTitle,
} from './parser.js';

type TradeAction = 'buy' | 'sell' | 'short' | 'cover';

const assertManageGuild = (interaction: ChatInputCommandInteraction): void => {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error('You need Manage Server to configure prediction markets.');
  }
};

const parseTradeCustomId = (
  customId: string,
): { action: TradeAction; marketId: string } | null => {
  const match = /^market:(buy|sell|short|cover):(.+)$/.exec(customId);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    action: match[1] as TradeAction,
    marketId: match[2],
  };
};

const parseQuickTradeCustomId = (
  customId: string,
): { action: 'buy' | 'short'; marketId: string; outcomeId: string } | null => {
  const match = /^market:quick:(buy|short):([^:]+):([^:]+)$/.exec(customId);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  return {
    action: match[1] as 'buy' | 'short',
    marketId: match[2],
    outcomeId: match[3],
  };
};

const parseTradeSelectCustomId = (
  customId: string,
): { action: TradeAction; marketId: string } | null => {
  const match = /^market:trade-select:(buy|sell|short|cover):(.+)$/.exec(customId);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    action: match[1] as TradeAction,
    marketId: match[2],
  };
};

const parseTradeModalCustomId = (
  customId: string,
): { action: TradeAction; marketId: string; outcomeId: string } | null => {
  const match = /^market:trade-modal:(buy|sell|short|cover):([^:]+):([^:]+)$/.exec(customId);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  return {
    action: match[1] as TradeAction,
    marketId: match[2],
    outcomeId: match[3],
  };
};

const parseSimpleMarketId = (prefix: string, customId: string): string | null => {
  const match = new RegExp(`^${prefix}:(.+)$`).exec(customId);
  return match?.[1] ?? null;
};

const parsePortfolioSelectionValue = (
  value: string,
): { action: 'sell' | 'cover'; marketId: string; outcomeId: string } | null => {
  const match = /^(sell|cover):([^:]+):([^:]+)$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  return {
    action: match[1] as 'sell' | 'cover',
    marketId: match[2],
    outcomeId: match[3],
  };
};

const validateEvidenceUrl = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Evidence URL must use http or https.');
    }

    return url.toString();
  } catch {
    throw new Error('Evidence URL must be a valid http or https URL.');
  }
};

const getTradeFeedback = (action: TradeAction): { title: string; color: number } => {
  switch (action) {
    case 'buy':
      return { title: 'Position Bought', color: 0x57f287 };
    case 'sell':
      return { title: 'Position Sold', color: 0x60a5fa };
    case 'short':
      return { title: 'Position Shorted', color: 0xf59e0b };
    case 'cover':
      return { title: 'Position Covered', color: 0xeb459e };
  }
};

export const handleMarketCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Prediction markets can only be used inside a server.');
  }

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === 'config') {
    assertManageGuild(interaction);

    if (subcommand === 'set') {
      const channel = interaction.options.getChannel('channel', true);
      if (!('isTextBased' in channel) || !channel.isTextBased()) {
        throw new Error('The official market channel must be text-based.');
      }

      const config = await setMarketConfig(interaction.guildId, channel.id);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildMarketStatusEmbed('Market Config Updated', describeMarketConfig({
          enabled: config.marketEnabled,
          channelId: config.marketChannelId,
        }))],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }

    if (subcommand === 'view') {
      const config = await getMarketConfig(interaction.guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildMarketStatusEmbed('Market Config', describeMarketConfig(config))],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }

    if (subcommand === 'disable') {
      const config = await disableMarketConfig(interaction.guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildMarketStatusEmbed('Market Config Disabled', describeMarketConfig({
          enabled: config.marketEnabled,
          channelId: config.marketChannelId,
        }), 0xef4444)],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
  }

  switch (subcommand) {
    case 'create': {
      await interaction.deferReply();
      const config = await getMarketConfig(interaction.guildId);
      if (!config.enabled || !config.channelId) {
        throw new Error('Prediction markets are not configured yet. Ask a server manager to run /market config set.');
      }

      const market = await createMarketRecord({
        guildId: interaction.guildId,
        creatorId: interaction.user.id,
        originChannelId: interaction.channelId,
        marketChannelId: config.channelId,
        title: sanitizeMarketTitle(interaction.options.getString('title', true)),
        description: sanitizeMarketDescription(interaction.options.getString('description')),
        outcomes: parseMarketOutcomes(interaction.options.getString('outcomes', true)),
        tags: parseMarketTags(interaction.options.getString('tags')),
        closeAt: parseMarketCloseAt(interaction.options.getString('close', true)),
      });
      let published: Awaited<ReturnType<typeof hydrateMarketMessage>>;
      try {
        published = await hydrateMarketMessage(client, market);
      } catch (error) {
        await deleteMarketRecord(market.id).catch(() => undefined);
        throw error;
      }
      await interaction.editReply({
        embeds: [
          buildMarketStatusEmbed(
            'Market Created',
            [
              `<@${interaction.user.id}> created **${market.title}** in <#${market.marketChannelId}>.`,
              `[Open market](${published.url})`,
              published.threadUrl
                ? `[Open discussion thread](${published.threadUrl})`
                : 'Discussion thread could not be created automatically.',
              `Market ID: \`${market.id}\``,
            ].join('\n'),
            0x57f287,
          ),
        ],
        allowedMentions: {
          parse: [],
          users: [interaction.user.id],
        },
      });
      return;
    }
    case 'edit': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const market = await getMarketByQuery(interaction.options.getString('query', true), interaction.guildId);
      if (!market) {
        throw new Error('Market not found.');
      }

      const updated = await editMarketRecord(market.id, interaction.user.id, {
        ...(interaction.options.getString('title') !== null ? { title: sanitizeMarketTitle(interaction.options.getString('title', true)) } : {}),
        ...(interaction.options.getString('description') !== null ? { description: sanitizeMarketDescription(interaction.options.getString('description')) } : {}),
        ...(interaction.options.getString('tags') !== null ? { tags: parseMarketTags(interaction.options.getString('tags')) } : {}),
        ...(interaction.options.getString('close') !== null ? { closeAt: parseMarketCloseAt(interaction.options.getString('close', true)) } : {}),
        ...(interaction.options.getString('outcomes') !== null ? { outcomes: parseMarketOutcomes(interaction.options.getString('outcomes', true)) } : {}),
      });
      await clearMarketJobs(updated.id);
      await scheduleMarketClose(updated);
      await refreshMarketMessage(client, updated.id);
      await interaction.editReply({
        embeds: [buildMarketStatusEmbed('Market Updated', `Updated **${updated.title}**.`)],
      });
      return;
    }
    case 'view': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const market = await getMarketByQuery(interaction.options.getString('query', true), interaction.guildId);
      if (!market) {
        throw new Error('Market not found.');
      }

      await interaction.editReply({
        ...(await buildMarketViewResponse(market)),
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    case 'list': {
      const status = interaction.options.getString('status') as 'open' | 'closed' | 'resolved' | 'cancelled' | null;
      const creatorId = interaction.options.getUser('creator')?.id;
      const tag = interaction.options.getString('tag')?.trim().toLowerCase();
      const markets = await listMarkets({
        guildId: interaction.guildId,
        ...(status ? { status } : {}),
        ...(creatorId ? { creatorId } : {}),
        ...(tag ? { tag } : {}),
      });
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildMarketListEmbed('Markets', markets)],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    case 'trade': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const market = await getMarketByQuery(interaction.options.getString('query', true), interaction.guildId);
      if (!market) {
        throw new Error('Market not found.');
      }

      const action = interaction.options.getString('action', true) as TradeAction;
      const rawAmount = interaction.options.getString('amount', true);
      const parsedAmount = action === 'buy'
        ? { amount: parseTradeAmount(rawAmount), amountMode: 'points' as const }
        : (() => {
            const parsed = parseFlexibleTradeAmount(rawAmount);
            return {
              amount: parsed.amount,
              amountMode: parsed.mode,
            };
          })();
      const outcome = parseOutcomeSelection(interaction.options.getString('outcome', true), market.outcomes);
      const result = await executeMarketTrade({
        marketId: market.id,
        userId: interaction.user.id,
        outcomeId: outcome.id,
        action,
        amount: parsedAmount.amount,
        amountMode: parsedAmount.amountMode,
      });
      const feedback = getTradeFeedback(action);
      await scheduleMarketRefresh(market.id);
      await interaction.editReply({
        embeds: [
          buildMarketStatusEmbed(
            feedback.title,
            [
              `Outcome: **${outcome.label}**`,
              `Cash: ${result.cashAmount} pts`,
              `Shares: ${Math.abs(result.shareDelta).toFixed(2)}`,
              `Bankroll: ${result.account.bankroll.toFixed(2)} pts`,
            ].join('\n'),
            feedback.color,
          ),
        ],
      });
      return;
    }
    case 'resolve': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const market = await getMarketByQuery(interaction.options.getString('query', true), interaction.guildId);
      if (!market) {
        throw new Error('Market not found.');
      }

      const outcome = parseOutcomeSelection(interaction.options.getString('winning_outcome', true), market.outcomes);
      const resolved = await resolveMarket({
        marketId: market.id,
        actorId: interaction.user.id,
        winningOutcomeId: outcome.id,
        note: interaction.options.getString('note'),
        evidenceUrl: validateEvidenceUrl(interaction.options.getString('evidence_url')),
        permissions: interaction.memberPermissions,
      });
      await clearMarketLifecycle(market.id);
      await refreshMarketMessage(client, market.id);
      await interaction.editReply({
        embeds: [
          buildMarketStatusEmbed(
            'Market Resolved',
            `Resolved **${resolved.market.title}** in favor of **${outcome.label}**.`,
            0x57f287,
          ),
        ],
      });
      return;
    }
    case 'resolve-outcome': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const market = await getMarketByQuery(interaction.options.getString('query', true), interaction.guildId);
      if (!market) {
        throw new Error('Market not found.');
      }

      const outcome = parseOutcomeSelection(interaction.options.getString('outcome', true), market.outcomes);
      const resolved = await resolveMarketOutcome({
        marketId: market.id,
        actorId: interaction.user.id,
        outcomeId: outcome.id,
        note: interaction.options.getString('note'),
        evidenceUrl: validateEvidenceUrl(interaction.options.getString('evidence_url')),
        permissions: interaction.memberPermissions,
      });
      await refreshMarketMessage(client, market.id);
      await interaction.editReply({
        embeds: [
          buildMarketStatusEmbed(
            'Outcome Resolved',
            `Resolved **${outcome.label}** as eliminated in **${resolved.market.title}**. Trading remains open on the remaining outcomes.`,
            0xf59e0b,
          ),
        ],
      });
      return;
    }
    case 'cancel': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const market = await getMarketByQuery(interaction.options.getString('query', true), interaction.guildId);
      if (!market) {
        throw new Error('Market not found.');
      }

      const cancelled = await cancelMarket({
        marketId: market.id,
        actorId: interaction.user.id,
        reason: interaction.options.getString('reason'),
        permissions: interaction.memberPermissions,
      });
      await clearMarketLifecycle(cancelled.id);
      await refreshMarketMessage(client, cancelled.id);
      await interaction.editReply({
        embeds: [
          buildMarketStatusEmbed(
            'Market Cancelled',
            `Cancelled **${cancelled.title}** and refunded open positions.`,
            0xf59e0b,
          ),
        ],
      });
      return;
    }
    case 'portfolio': {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const portfolio = await getMarketAccountSummary(interaction.guildId, user.id);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        ...buildPortfolioMessage(user.id, portfolio, user.id === interaction.user.id),
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    case 'leaderboard': {
      const entries = await getMarketLeaderboard(interaction.guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildLeaderboardEmbed(entries.map((entry) => ({
          userId: entry.userId,
          bankroll: entry.bankroll,
          realizedProfit: entry.realizedProfit,
        })))],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    default:
      throw new Error('Unknown market subcommand.');
  }
};

export const handleMarketButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const quickTrade = parseQuickTradeCustomId(interaction.customId);
  if (quickTrade) {
    await interaction.showModal(buildMarketTradeModal(
      quickTrade.action,
      quickTrade.marketId,
      quickTrade.outcomeId,
    ));
    return;
  }

  const tradeAction = parseTradeCustomId(interaction.customId);
  if (tradeAction) {
    const market = await getMarketById(tradeAction.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      ...buildMarketTradeSelector(market, tradeAction.action),
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  const portfolioMarketId = parseSimpleMarketId('market:portfolio', interaction.customId);
  if (portfolioMarketId) {
    const market = await getMarketById(portfolioMarketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    const portfolio = await getMarketAccountSummary(market.guildId, interaction.user.id);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      ...buildPortfolioMessage(interaction.user.id, portfolio, true),
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  const refreshMarketId = parseSimpleMarketId('market:refresh', interaction.customId);
  if (refreshMarketId) {
    await interaction.deferUpdate();
    await refreshMarketMessage(interaction.client, refreshMarketId);
    return;
  }

  const resolveMarketId = parseSimpleMarketId('market:resolve', interaction.customId);
  if (resolveMarketId) {
    await interaction.showModal(buildMarketResolveModal(resolveMarketId));
    return;
  }

  const cancelMarketId = parseSimpleMarketId('market:cancel', interaction.customId);
  if (cancelMarketId) {
    await interaction.showModal(buildMarketCancelModal(cancelMarketId));
  }
};

export const handleMarketSelect = async (
  interaction: StringSelectMenuInteraction,
): Promise<void> => {
  if (interaction.customId === marketPortfolioSelectCustomId()) {
    const value = interaction.values[0];
    if (!value) {
      throw new Error('Choose a position first.');
    }

    const parsedValue = parsePortfolioSelectionValue(value);
    if (!parsedValue) {
      throw new Error('Unknown portfolio action.');
    }

    await interaction.showModal(buildMarketTradeModal(
      parsedValue.action,
      parsedValue.marketId,
      parsedValue.outcomeId,
    ));
    return;
  }

  const parsed = parseTradeSelectCustomId(interaction.customId);
  if (!parsed) {
    throw new Error('Unknown market select action.');
  }

  const outcomeId = interaction.values[0];
  if (!outcomeId) {
    throw new Error('Choose a market outcome first.');
  }

  await interaction.showModal(buildMarketTradeModal(parsed.action, parsed.marketId, outcomeId));
};

export const handleMarketModal = async (
  client: Client,
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  const trade = parseTradeModalCustomId(interaction.customId);
  if (trade) {
    const market = await getMarketById(trade.marketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    const result = await executeMarketTrade({
      marketId: trade.marketId,
      userId: interaction.user.id,
      outcomeId: trade.outcomeId,
      action: trade.action,
      ...(trade.action === 'buy'
        ? {
            amount: parseTradeAmount(interaction.fields.getTextInputValue('amount')),
            amountMode: 'points' as const,
          }
        : (() => {
            const parsedAmount = parseFlexibleTradeAmount(interaction.fields.getTextInputValue('amount'));
            return {
              amount: parsedAmount.amount,
              amountMode: parsedAmount.mode,
            };
          })()),
    });
    await scheduleMarketRefresh(trade.marketId);
    const outcome = market.outcomes.find((entry) => entry.id === trade.outcomeId);
    const feedback = getTradeFeedback(trade.action);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [
        buildMarketStatusEmbed(
          feedback.title,
            [
              `Outcome: **${outcome?.label ?? 'Unknown'}**`,
              `Cash: ${result.cashAmount} pts`,
              `Shares: ${Math.abs(result.shareDelta).toFixed(2)}`,
              `Bankroll: ${result.account.bankroll.toFixed(2)} pts`,
            ].join('\n'),
          feedback.color,
        ),
      ],
    });
    return;
  }

  const resolveMarketId = parseSimpleMarketId('market:resolve-modal', interaction.customId);
  if (resolveMarketId) {
    const market = await getMarketById(resolveMarketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    const outcome = parseOutcomeSelection(interaction.fields.getTextInputValue('winning_outcome'), market.outcomes);
    await resolveMarket({
      marketId: market.id,
      actorId: interaction.user.id,
      winningOutcomeId: outcome.id,
      note: interaction.fields.getTextInputValue('note').trim() || null,
      evidenceUrl: validateEvidenceUrl(interaction.fields.getTextInputValue('evidence_url')),
      ...(interaction.inGuild() ? { permissions: interaction.memberPermissions ?? null } : {}),
    });
    await clearMarketLifecycle(market.id);
    await refreshMarketMessage(client, market.id);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildMarketStatusEmbed('Market Resolved', `Resolved **${market.title}** in favor of **${outcome.label}**.`, 0x57f287)],
    });
    return;
  }

  const cancelMarketId = parseSimpleMarketId('market:cancel-modal', interaction.customId);
  if (cancelMarketId) {
    const market = await getMarketById(cancelMarketId);
    if (!market) {
      throw new Error('Market not found.');
    }

    await cancelMarket({
      marketId: market.id,
      actorId: interaction.user.id,
      reason: interaction.fields.getTextInputValue('reason').trim() || null,
      ...(interaction.inGuild() ? { permissions: interaction.memberPermissions ?? null } : {}),
    });
    await clearMarketLifecycle(market.id);
    await refreshMarketMessage(client, market.id);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildMarketStatusEmbed('Market Cancelled', `Cancelled **${market.title}** and refunded open positions.`, 0xf59e0b)],
    });
    return;
  }

  throw new Error('Unknown market modal action.');
};
