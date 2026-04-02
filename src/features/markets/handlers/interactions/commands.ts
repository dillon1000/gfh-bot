import { MessageFlags, type ChatInputCommandInteraction, type Client } from 'discord.js';

import { logger } from '../../../../app/logger.js';
import {
  buildLeaderboardEmbed,
  buildMarketForecastLeaderboardEmbed,
  buildMarketForecastProfileEmbed,
  buildMarketListEmbed,
  buildMarketTradersEmbeds,
} from '../../ui/render/analytics.js';
import { buildMarketStatusEmbed } from '../../ui/render/market.js';
import { buildPortfolioMessage } from '../../ui/render/portfolio.js';
import { getMarketConfig } from '../../services/config.js';
import {
  announceMarketUpdate,
  buildMarketViewResponse,
  clearMarketLifecycle,
  hydrateMarketMessage,
  notifyMarketResolved,
  refreshMarketMessage,
} from '../../services/lifecycle.js';
import {
  getMarketAccountSummary,
  getMarketLeaderboard,
  grantMarketBankroll,
} from '../../services/account.js';
import {
  getMarketForecastLeaderboard,
  getMarketForecastProfile,
} from '../../services/forecast/queries.js';
import {
  appendMarketOutcomes,
  createMarketRecord,
  deleteMarketRecord,
  editMarketRecord,
  getMarketByQuery,
  listMarkets,
  summarizeMarketTraders,
} from '../../services/records.js';
import {
  clearMarketJobs,
  scheduleMarketClose,
  scheduleMarketRefresh,
} from '../../services/scheduler.js';
import { cancelMarket } from '../../services/trading/cancel.js';
import { executeMarketTrade } from '../../services/trading/execution.js';
import {
  resolveMarket,
  resolveMarketOutcome,
} from '../../services/trading/resolution.js';
import {
  parseAdditionalMarketOutcomes,
  parseMarketOutcomes,
  parseMarketTags,
  parseOutcomeSelection,
  sanitizeMarketDescription,
  sanitizeMarketTitle,
} from '../../parsing/market.js';
import { parseMarketCloseAt } from '../../parsing/close.js';
import { createTradeQuotePreview } from './quotes.js';
import {
  assertCanGrantMarketFunds,
  buildTradeExecutionDescription,
  getTradeFeedback,
  parseTradeInputAmount,
  type TradeAction,
  validateEvidenceUrl,
} from './shared.js';
import { handleMarketConfigCommand } from './config.js';
import type { MarketWithRelations } from '../../core/types.js';

const describeMarketEditChanges = (previous: MarketWithRelations, updated: MarketWithRelations): string[] => {
  const changes: string[] = [];
  if (previous.title !== updated.title) {
    changes.push(`Title: **${previous.title}** -> **${updated.title}**`);
  }

  if ((previous.description ?? '') !== (updated.description ?? '')) {
    changes.push(`Description: ${updated.description ? 'updated' : 'cleared'}`);
  }

  if (previous.closeAt.getTime() !== updated.closeAt.getTime()) {
    changes.push(`Close time: <t:${Math.floor(updated.closeAt.getTime() / 1000)}:F>`);
  }

  if (previous.buttonStyle !== updated.buttonStyle) {
    changes.push(`Button style: **${previous.buttonStyle}** -> **${updated.buttonStyle}**`);
  }

  if (previous.tags.join(',') !== updated.tags.join(',')) {
    changes.push(`Tags: ${updated.tags.length > 0 ? updated.tags.map((tag) => `\`${tag}\``).join(' ') : 'none'}`);
  }

  if (previous.outcomes.map((outcome) => outcome.label).join('|') !== updated.outcomes.map((outcome) => outcome.label).join('|')) {
    changes.push(`Outcomes: ${updated.outcomes.map((outcome) => `**${outcome.label}**`).join(', ')}`);
  }

  return changes;
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

  if (subcommandGroup === 'config' && await handleMarketConfigCommand(interaction)) {
    return;
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
        buttonStyle: (interaction.options.getString('button_style') as MarketWithRelations['buttonStyle'] | null) ?? 'primary',
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
        ...(interaction.options.getString('button_style') !== null ? { buttonStyle: interaction.options.getString('button_style', true) as MarketWithRelations['buttonStyle'] } : {}),
        ...(interaction.options.getString('tags') !== null ? { tags: parseMarketTags(interaction.options.getString('tags')) } : {}),
        ...(interaction.options.getString('close') !== null ? { closeAt: parseMarketCloseAt(interaction.options.getString('close', true)) } : {}),
        ...(interaction.options.getString('outcomes') !== null ? { outcomes: parseMarketOutcomes(interaction.options.getString('outcomes', true)) } : {}),
      });
      await clearMarketJobs(updated.id);
      await scheduleMarketClose(updated);
      await refreshMarketMessage(client, updated.id);
      const changes = describeMarketEditChanges(market, updated);
      if (changes.length > 0) {
        await announceMarketUpdate(
          client,
          updated,
          'Market Updated',
          [
            `**${updated.title}** was updated by <@${interaction.user.id}>.`,
            ...changes,
          ].join('\n'),
        );
      }
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
    case 'add-outcomes': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const market = await getMarketByQuery(interaction.options.getString('query', true), interaction.guildId);
      if (!market) {
        throw new Error('Market not found.');
      }

      const updated = await appendMarketOutcomes(
        market.id,
        interaction.user.id,
        parseAdditionalMarketOutcomes(interaction.options.getString('outcomes', true)),
      );
      await refreshMarketMessage(client, updated.id);
      await announceMarketUpdate(
        client,
        updated,
        'Outcomes Added',
        [
          `**${updated.title}** has ${updated.outcomes.length - market.outcomes.length} new outcome${updated.outcomes.length - market.outcomes.length === 1 ? '' : 's'}.`,
          ...updated.outcomes
            .slice(market.outcomes.length)
            .map((outcome) => `• ${outcome.label}`),
        ].join('\n'),
        0x57f287,
      );
      await interaction.editReply({
        embeds: [
          buildMarketStatusEmbed(
            'Outcomes Added',
            `Added ${updated.outcomes.length - market.outcomes.length} outcome${updated.outcomes.length - market.outcomes.length === 1 ? '' : 's'} to **${updated.title}**.`,
            0x57f287,
          ),
        ],
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
      const outcome = parseOutcomeSelection(interaction.options.getString('outcome', true), market.outcomes);
      if (action === 'buy' || action === 'short') {
        await interaction.editReply({
          ...await createTradeQuotePreview({
            marketId: market.id,
            userId: interaction.user.id,
            outcomeId: outcome.id,
            action,
            rawAmount,
          }),
          allowedMentions: {
            parse: [],
          },
        });
        return;
      }

      const parsedAmount = parseTradeInputAmount(action, rawAmount);
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
            buildTradeExecutionDescription(action, outcome.label, result),
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
      await notifyMarketResolved(client, resolved);
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
      await announceMarketUpdate(
        client,
        resolved.market,
        'Outcome Resolved',
        `**${outcome.label}** was eliminated in **${resolved.market.title}** by <@${interaction.user.id}>. Trading remains open on the remaining outcomes.`,
        0xf59e0b,
      );
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
      await announceMarketUpdate(
        client,
        cancelled,
        'Market Cancelled',
        [
          `**${cancelled.title}** was cancelled by <@${interaction.user.id}>.`,
          interaction.options.getString('reason') ? `Reason: ${interaction.options.getString('reason', true)}` : null,
        ].filter(Boolean).join('\n'),
        0xf59e0b,
      );
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
    case 'traders': {
      const market = await getMarketByQuery(interaction.options.getString('query', true), interaction.guildId);
      if (!market) {
        throw new Error('Market not found.');
      }

      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: buildMarketTradersEmbeds(summarizeMarketTraders(market)),
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    case 'profile': {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const profile = await getMarketForecastProfile(interaction.guildId, user.id);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildMarketForecastProfileEmbed(profile)],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    case 'grant': {
      assertCanGrantMarketFunds(interaction.user.id);
      const user = interaction.options.getUser('user', true);
      const amount = interaction.options.getNumber('amount', true);
      const reason = interaction.options.getString('reason', true).trim();
      if (reason.length === 0) {
        throw new Error('Grant reason must contain at least one non-space character.');
      }

      const account = await grantMarketBankroll({
        guildId: interaction.guildId,
        userId: user.id,
        amount,
      });

      let dmDelivered = true;
      await user.send({
        embeds: [
          buildMarketStatusEmbed(
            'Market Currency Granted',
            [
              `You received **${amount.toFixed(2)} pts** in market currency.`,
              `Reason: ${reason}`,
              `New bankroll: **${account.bankroll.toFixed(2)} pts**`,
            ].join('\n'),
            0x57f287,
          ),
        ],
        allowedMentions: {
          parse: [],
        },
      }).catch((error) => {
        dmDelivered = false;
        logger.warn(
          { err: error, guildId: interaction.guildId, adminUserId: interaction.user.id, recipientUserId: user.id },
          'Could not DM market grant recipient',
        );
      });

      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [
          buildMarketStatusEmbed(
            'Market Currency Granted',
            [
              `Granted **${amount.toFixed(2)} pts** to <@${user.id}>.`,
              `Reason: ${reason}`,
              `New bankroll: **${account.bankroll.toFixed(2)} pts**`,
              dmDelivered ? 'Recipient DM sent.' : 'Recipient DM could not be delivered.',
            ].join('\n'),
            0x57f287,
          ),
        ],
        allowedMentions: {
          parse: [],
          users: [user.id],
        },
      });
      return;
    }
    case 'leaderboard': {
      const board = interaction.options.getString('board') ?? 'bankroll';
      if (board === 'forecast') {
        const window = (interaction.options.getString('window') as 'all_time' | '30d' | null) ?? 'all_time';
        const tag = interaction.options.getString('tag')?.trim().toLowerCase() ?? null;
        const entries = await getMarketForecastLeaderboard({
          guildId: interaction.guildId,
          window,
          ...(tag ? { tag } : {}),
        });
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          embeds: buildMarketForecastLeaderboardEmbed(entries, window, tag),
          allowedMentions: {
            parse: [],
          },
        });
        return;
      }

      const entries = await getMarketLeaderboard(interaction.guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: buildLeaderboardEmbed(entries.map((entry) => ({
          userId: entry.userId,
          bankroll: entry.bankroll,
          realizedProfit: entry.realizedProfit,
        }))),
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
