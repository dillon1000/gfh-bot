import {
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { redis } from '../../lib/redis.js';
import { getEffectiveEconomyAccountPreview } from '../economy/service.js';
import {
  describeCasinoConfig,
  disableCasinoConfig,
  getCasinoConfig,
  setCasinoConfig,
} from './config-service.js';
import {
  buildBlackjackPrompt,
  buildBlackjackResultEmbed,
  buildCasinoBalanceEmbed,
  buildCasinoStatsEmbed,
  buildCasinoStatusEmbed,
  buildPokerPrompt,
  buildPokerResultEmbed,
  buildRtdResultEmbed,
  buildSlotsResultEmbed,
} from './render.js';
import {
  drawPoker,
  getCasinoStatsSummary,
  hitBlackjack,
  playRtd,
  playSlots,
  standBlackjack,
  startBlackjack,
  startPoker,
  updatePokerDiscardSelection,
} from './service.js';
import {
  deleteCasinoSession,
  getCasinoSession,
  saveCasinoSession,
} from './session-store.js';

const assertManageGuild = (interaction: ChatInputCommandInteraction): void => {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new Error('You need Manage Server to configure casino mode.');
  }
};

const assertCasinoEnabled = async (guildId: string): Promise<{ channelId: string }> => {
  const config = await getCasinoConfig(guildId);
  if (!config.enabled || !config.channelId) {
    throw new Error('Casino mode is not configured yet. Ask a server manager to run /casino config set.');
  }

  return {
    channelId: config.channelId,
  };
};

const assertCasinoChannel = (interaction: ChatInputCommandInteraction, channelId: string): void => {
  if (interaction.channelId !== channelId) {
    throw new Error(`Casino games must be started in <#${channelId}>.`);
  }
};

const assertNoActiveSession = async (
  guildId: string,
  userId: string,
): Promise<void> => {
  const session = await getCasinoSession(redis, guildId, userId);
  if (session) {
    throw new Error('Finish your current casino game before starting a new one.');
  }
};

const parseOwnerCustomId = (
  customId: string,
  pattern: RegExp,
): { ownerId: string } | null => {
  const match = pattern.exec(customId);
  if (!match?.[1]) {
    return null;
  }

  return {
    ownerId: match[1],
  };
};

const assertSessionOwner = async (
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  ownerId: string,
): Promise<boolean> => {
  if (interaction.user.id === ownerId) {
    return true;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildCasinoStatusEmbed('Not Your Game', 'That casino session belongs to someone else.', 0xef4444)],
  });
  return false;
};

const getGuildIdFromInteraction = (
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): string => {
  if (!interaction.guildId) {
    throw new Error('Casino games can only be used inside a server.');
  }

  return interaction.guildId;
};

const getRequiredWager = (interaction: ChatInputCommandInteraction): number => interaction.options.getInteger('bet', true);

export const handleCasinoCommand = async (
  _client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Casino mode can only be used inside a server.');
  }

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === 'config') {
    assertManageGuild(interaction);

    if (subcommand === 'set') {
      const channel = interaction.options.getChannel('channel', true);
      if (!('isTextBased' in channel) || !channel.isTextBased()) {
        throw new Error('The official casino channel must be text-based.');
      }

      const config = await setCasinoConfig(interaction.guildId, channel.id);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildCasinoStatusEmbed('Casino Config Updated', describeCasinoConfig({
          enabled: config.casinoEnabled,
          channelId: config.casinoChannelId,
        }))],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }

    if (subcommand === 'view') {
      const config = await getCasinoConfig(interaction.guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildCasinoStatusEmbed('Casino Config', describeCasinoConfig(config))],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }

    if (subcommand === 'disable') {
      const config = await disableCasinoConfig(interaction.guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildCasinoStatusEmbed('Casino Config Disabled', describeCasinoConfig({
          enabled: config.casinoEnabled,
          channelId: config.casinoChannelId,
        }), 0xef4444)],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
  }

  if (subcommand === 'balance') {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const account = await getEffectiveEconomyAccountPreview(interaction.guildId, user.id);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildCasinoBalanceEmbed(user.id, account.bankroll)],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  if (subcommand === 'stats') {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const summary = await getCasinoStatsSummary(interaction.guildId, user.id);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildCasinoStatsEmbed(summary)],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  const config = await assertCasinoEnabled(interaction.guildId);
  assertCasinoChannel(interaction, config.channelId);
  await assertNoActiveSession(interaction.guildId, interaction.user.id);

  if (subcommand === 'slots') {
    await interaction.deferReply();
    const result = await playSlots({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      wager: getRequiredWager(interaction),
    });
    await interaction.editReply({
      embeds: [buildSlotsResultEmbed(interaction.user.id, result.persisted, result.spin)],
      components: [],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  if (subcommand === 'rtd') {
    await interaction.deferReply();
    const result = await playRtd({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      wager: getRequiredWager(interaction),
    });
    await interaction.editReply({
      embeds: [buildRtdResultEmbed(interaction.user.id, result.persisted, result.round)],
      components: [],
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  if (subcommand === 'blackjack') {
    await interaction.deferReply();
    const started = await startBlackjack({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      wager: getRequiredWager(interaction),
    });

    if (started.kind === 'result') {
      await interaction.editReply({
        embeds: [buildBlackjackResultEmbed(interaction.user.id, started.persisted, started.round)],
        components: [],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }

    await saveCasinoSession(redis, started.session);
    await interaction.editReply({
      ...buildBlackjackPrompt(interaction.user.id, started.session),
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  if (subcommand === 'poker') {
    await interaction.deferReply();
    const session = await startPoker({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      wager: getRequiredWager(interaction),
    });
    await saveCasinoSession(redis, session);
    await interaction.editReply({
      ...buildPokerPrompt(interaction.user.id, session),
      allowedMentions: {
        parse: [],
      },
    });
    return;
  }

  throw new Error('Unknown casino subcommand.');
};

export const handleCasinoButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const blackjackHit = parseOwnerCustomId(interaction.customId, /^casino:blackjack:hit:(.+)$/);
  if (blackjackHit) {
    if (!(await assertSessionOwner(interaction, blackjackHit.ownerId))) {
      return;
    }
    const guildId = getGuildIdFromInteraction(interaction);
    const session = await getCasinoSession(redis, guildId, blackjackHit.ownerId);
    if (!session || session.kind !== 'blackjack') {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildCasinoStatusEmbed('Game Expired', 'That blackjack hand has expired.', 0xef4444)],
      });
      return;
    }

    const next = await hitBlackjack(session);
    if (next.kind === 'result') {
      await deleteCasinoSession(redis, guildId, blackjackHit.ownerId);
      await interaction.update({
        embeds: [buildBlackjackResultEmbed(blackjackHit.ownerId, next.persisted, next.round)],
        components: [],
      });
      return;
    }

    await saveCasinoSession(redis, next.session);
    await interaction.update(buildBlackjackPrompt(blackjackHit.ownerId, next.session));
    return;
  }

  const blackjackStand = parseOwnerCustomId(interaction.customId, /^casino:blackjack:stand:(.+)$/);
  if (blackjackStand) {
    if (!(await assertSessionOwner(interaction, blackjackStand.ownerId))) {
      return;
    }
    const guildId = getGuildIdFromInteraction(interaction);
    const session = await getCasinoSession(redis, guildId, blackjackStand.ownerId);
    if (!session || session.kind !== 'blackjack') {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildCasinoStatusEmbed('Game Expired', 'That blackjack hand has expired.', 0xef4444)],
      });
      return;
    }

    const result = await standBlackjack(session);
    await deleteCasinoSession(redis, guildId, blackjackStand.ownerId);
    await interaction.update({
      embeds: [buildBlackjackResultEmbed(blackjackStand.ownerId, result.persisted, result.round)],
      components: [],
    });
    return;
  }

  const pokerDraw = parseOwnerCustomId(interaction.customId, /^casino:poker:draw:(.+)$/);
  if (pokerDraw) {
    if (!(await assertSessionOwner(interaction, pokerDraw.ownerId))) {
      return;
    }
    const guildId = getGuildIdFromInteraction(interaction);
    const session = await getCasinoSession(redis, guildId, pokerDraw.ownerId);
    if (!session || session.kind !== 'poker') {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildCasinoStatusEmbed('Game Expired', 'That poker hand has expired.', 0xef4444)],
      });
      return;
    }

    const result = await drawPoker({ session });
    await deleteCasinoSession(redis, guildId, pokerDraw.ownerId);
    await interaction.update({
      embeds: [buildPokerResultEmbed(pokerDraw.ownerId, result.persisted, result.round)],
      components: [],
    });
    return;
  }

  throw new Error('Unknown casino button.');
};

export const handleCasinoSelect = async (
  interaction: StringSelectMenuInteraction,
): Promise<void> => {
  const pokerDiscard = parseOwnerCustomId(interaction.customId, /^casino:poker:discard:(.+)$/);
  if (!pokerDiscard) {
    throw new Error('Unknown casino select menu.');
  }

  if (!(await assertSessionOwner(interaction, pokerDiscard.ownerId))) {
    return;
  }
  const guildId = getGuildIdFromInteraction(interaction);
  const session = await getCasinoSession(redis, guildId, pokerDiscard.ownerId);
  if (!session || session.kind !== 'poker') {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [buildCasinoStatusEmbed('Game Expired', 'That poker hand has expired.', 0xef4444)],
    });
    return;
  }

  const updated = updatePokerDiscardSelection(
    session,
    interaction.values.map((value) => Number.parseInt(value, 10)).filter(Number.isInteger),
  );
  await saveCasinoSession(redis, updated);
  await interaction.update(buildPokerPrompt(pokerDiscard.ownerId, updated));
};
