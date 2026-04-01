import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { redis } from '../../lib/redis.js';
import { getEffectiveEconomyAccountPreview } from '../economy/service.js';
import {
  casinoTableBlackjackDoubleButtonCustomId,
  casinoTableBlackjackHitButtonCustomId,
  casinoTableBlackjackStandButtonCustomId,
  casinoTableCloseButtonCustomId,
  casinoTableHoldemCallButtonCustomId,
  casinoTableHoldemCheckButtonCustomId,
  casinoTableHoldemFoldButtonCustomId,
  casinoTableHoldemRaiseButtonCustomId,
  casinoTableHoldemRaiseModalCustomId,
  casinoTableJoinButtonCustomId,
  casinoTableLeaveButtonCustomId,
  casinoTablePeekButtonCustomId,
  casinoTableStartButtonCustomId,
} from './custom-ids.js';
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
import {
  buildCasinoTableListEmbed,
  buildCasinoTableMessage,
  buildCasinoTablePrivateEmbed,
} from './table-render.js';
import { clearCasinoTableTimeout, scheduleCasinoTableTimeout } from './table-schedule-service.js';
import {
  advanceCasinoTableTimeout,
  attachCasinoTableMessage,
  attachCasinoTableThread,
  closeCasinoTable,
  createCasinoTable,
  getCasinoTable,
  getCasinoTablePrivateView,
  joinCasinoTable,
  leaveCasinoTable,
  listCasinoTables,
  performCasinoTableAction,
  startCasinoTable,
} from './table-service.js';
import type { CasinoTableSummary } from './types.js';

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
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
): string => {
  if (!interaction.guildId) {
    throw new Error('Casino games can only be used inside a server.');
  }

  return interaction.guildId;
};

const getRequiredWager = (interaction: ChatInputCommandInteraction): number => interaction.options.getInteger('bet', true);

const getRequiredTableId = (interaction: ChatInputCommandInteraction): string =>
  interaction.options.getString('table', true);

const syncCasinoTableMessage = async (client: Client, tableId: string): Promise<void> => {
  const table = await getCasinoTable(tableId);
  if (!table?.messageId) {
    return;
  }

  const channel = await client.channels.fetch(table.channelId).catch(() => null);
  if (!channel?.isTextBased() || !('messages' in channel)) {
    return;
  }

  const message = await channel.messages.fetch(table.messageId).catch(() => null);
  if (!message) {
    return;
  }

  await message.edit({
    ...buildCasinoTableMessage(table),
    allowedMentions: {
      parse: [],
    },
  });
};

const syncCasinoTableRuntime = async (table: CasinoTableSummary): Promise<void> => {
  if (table.actionDeadlineAt) {
    await scheduleCasinoTableTimeout(table.id, table.actionDeadlineAt);
    return;
  }

  await clearCasinoTableTimeout(table.id);
};

const ensureCasinoTableThread = async (client: Client, tableId: string): Promise<void> => {
  const table = await getCasinoTable(tableId);
  if (!table?.messageId || table.threadId) {
    return;
  }

  const channel = await client.channels.fetch(table.channelId).catch(() => null);
  if (!channel?.isTextBased() || !('messages' in channel)) {
    return;
  }

  const message = await channel.messages.fetch(table.messageId).catch(() => null);
  if (!message) {
    return;
  }

  const thread = await message.startThread({
    name: `${table.name}`.slice(0, 100),
    autoArchiveDuration: 1440,
  }).catch(() => null);
  if (!thread) {
    return;
  }

  await attachCasinoTableThread(table.id, thread.id);
  await thread.send({
    embeds: [buildCasinoStatusEmbed('Table Started', `Live updates for **${table.name}** will land here.`)],
    allowedMentions: {
      parse: [],
    },
  }).catch(() => undefined);
};

const handleTableCreateCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  await interaction.deferReply();
  const game = interaction.options.getString('game', true) as 'blackjack' | 'holdem';
  const created = await createCasinoTable({
    guildId: interaction.guildId!,
    channelId: interaction.channelId,
    hostUserId: interaction.user.id,
    game,
    ...(interaction.options.getString('name') !== null
      ? { name: interaction.options.getString('name', true) }
      : {}),
    ...(interaction.options.getInteger('wager') !== null
      ? { baseWager: interaction.options.getInteger('wager', true) }
      : {}),
    ...(interaction.options.getInteger('small_blind') !== null
      ? { smallBlind: interaction.options.getInteger('small_blind', true) }
      : {}),
    ...(interaction.options.getInteger('big_blind') !== null
      ? { bigBlind: interaction.options.getInteger('big_blind', true) }
      : {}),
    ...(interaction.options.getInteger('buy_in') !== null
      ? { buyIn: interaction.options.getInteger('buy_in', true) }
      : {}),
  });

  await interaction.editReply({
    ...buildCasinoTableMessage(created),
    allowedMentions: {
      parse: [],
    },
  });

  const message = await interaction.fetchReply();
  await attachCasinoTableMessage(created.id, message.id);
  await syncCasinoTableRuntime(created);
  await syncCasinoTableMessage(client, created.id);
};

const handleTableJoinCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const table = await joinCasinoTable({
    tableId: getRequiredTableId(interaction),
    userId: interaction.user.id,
    ...(interaction.options.getInteger('buy_in') !== null
      ? { buyIn: interaction.options.getInteger('buy_in', true) }
      : {}),
  });
  await syncCasinoTableRuntime(table);
  await syncCasinoTableMessage(client, table.id);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildCasinoStatusEmbed('Table Joined', `You joined **${table.name}**.`)],
  });
};

const handleTableLeaveCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const table = await leaveCasinoTable(getRequiredTableId(interaction), interaction.user.id);
  await syncCasinoTableRuntime(table);
  await syncCasinoTableMessage(client, table.id);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildCasinoStatusEmbed('Table Left', `You left **${table.name}**.`)],
  });
};

const handleTableStartCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const table = await startCasinoTable(getRequiredTableId(interaction), interaction.user.id);
  await syncCasinoTableRuntime(table);
  await ensureCasinoTableThread(client, table.id);
  await syncCasinoTableMessage(client, table.id);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildCasinoStatusEmbed('Hand Started', `Started hand ${table.currentHandNumber} at **${table.name}**.`)],
  });
};

const handleTableCloseCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const table = await closeCasinoTable(getRequiredTableId(interaction), interaction.user.id);
  await syncCasinoTableRuntime(table);
  await syncCasinoTableMessage(client, table.id);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildCasinoStatusEmbed('Table Closed', `Closed **${table.name}**.`)],
  });
};

const handleTableViewCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const view = await getCasinoTablePrivateView(getRequiredTableId(interaction), interaction.user.id);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [
      buildCasinoTablePrivateEmbed(view.table, view.privateCards, view.note),
    ],
  });
};

export const handleCasinoCommand = async (
  client: Client,
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

  if (subcommandGroup === 'table') {
    if (subcommand === 'create') {
      await handleTableCreateCommand(client, interaction);
      return;
    }
    if (subcommand === 'list') {
      const tables = await listCasinoTables(interaction.guildId);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [buildCasinoTableListEmbed(tables)],
      });
      return;
    }
    if (subcommand === 'view') {
      await handleTableViewCommand(interaction);
      return;
    }
    if (subcommand === 'join') {
      await handleTableJoinCommand(client, interaction);
      return;
    }
    if (subcommand === 'leave') {
      await handleTableLeaveCommand(client, interaction);
      return;
    }
    if (subcommand === 'start') {
      await handleTableStartCommand(client, interaction);
      return;
    }
    if (subcommand === 'close') {
      await handleTableCloseCommand(client, interaction);
      return;
    }
  }

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

  const tablePatterns: Array<{
    match: RegExpMatchArray | null;
    handler: (tableId: string) => Promise<void>;
  }> = [
    {
      match: interaction.customId.match(/^casino:table:join:(.+)$/),
      handler: async (tableId) => {
        const updated = await joinCasinoTable({
          tableId,
          userId: interaction.user.id,
        });
        await syncCasinoTableRuntime(updated);
        await interaction.update(buildCasinoTableMessage(updated));
      },
    },
    {
      match: interaction.customId.match(/^casino:table:leave:(.+)$/),
      handler: async (tableId) => {
        const updated = await leaveCasinoTable(tableId, interaction.user.id);
        await syncCasinoTableRuntime(updated);
        await interaction.update(buildCasinoTableMessage(updated));
      },
    },
    {
      match: interaction.customId.match(/^casino:table:start:(.+)$/),
      handler: async (tableId) => {
        const updated = await startCasinoTable(tableId, interaction.user.id);
        await syncCasinoTableRuntime(updated);
        await interaction.update(buildCasinoTableMessage(updated));
      },
    },
    {
      match: interaction.customId.match(/^casino:table:close:(.+)$/),
      handler: async (tableId) => {
        const updated = await closeCasinoTable(tableId, interaction.user.id);
        await syncCasinoTableRuntime(updated);
        await interaction.update(buildCasinoTableMessage(updated));
      },
    },
    {
      match: interaction.customId.match(/^casino:table:peek:(.+)$/),
      handler: async (tableId) => {
        const view = await getCasinoTablePrivateView(tableId, interaction.user.id);
        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          embeds: [buildCasinoTablePrivateEmbed(view.table, view.privateCards, view.note)],
        });
      },
    },
    {
      match: interaction.customId.match(/^casino:table:blackjack:hit:(.+)$/),
      handler: async (tableId) => {
        const updated = await performCasinoTableAction({
          tableId,
          userId: interaction.user.id,
          action: 'blackjack_hit',
        });
        await syncCasinoTableRuntime(updated);
        await interaction.update(buildCasinoTableMessage(updated));
      },
    },
    {
      match: interaction.customId.match(/^casino:table:blackjack:stand:(.+)$/),
      handler: async (tableId) => {
        const updated = await performCasinoTableAction({
          tableId,
          userId: interaction.user.id,
          action: 'blackjack_stand',
        });
        await syncCasinoTableRuntime(updated);
        await interaction.update(buildCasinoTableMessage(updated));
      },
    },
    {
      match: interaction.customId.match(/^casino:table:blackjack:double:(.+)$/),
      handler: async (tableId) => {
        const updated = await performCasinoTableAction({
          tableId,
          userId: interaction.user.id,
          action: 'blackjack_double',
        });
        await syncCasinoTableRuntime(updated);
        await interaction.update(buildCasinoTableMessage(updated));
      },
    },
    {
      match: interaction.customId.match(/^casino:table:holdem:fold:(.+)$/),
      handler: async (tableId) => {
        const updated = await performCasinoTableAction({
          tableId,
          userId: interaction.user.id,
          action: 'holdem_fold',
        });
        await syncCasinoTableRuntime(updated);
        await interaction.update(buildCasinoTableMessage(updated));
      },
    },
    {
      match: interaction.customId.match(/^casino:table:holdem:check:(.+)$/),
      handler: async (tableId) => {
        const updated = await performCasinoTableAction({
          tableId,
          userId: interaction.user.id,
          action: 'holdem_check',
        });
        await syncCasinoTableRuntime(updated);
        await interaction.update(buildCasinoTableMessage(updated));
      },
    },
    {
      match: interaction.customId.match(/^casino:table:holdem:call:(.+)$/),
      handler: async (tableId) => {
        const updated = await performCasinoTableAction({
          tableId,
          userId: interaction.user.id,
          action: 'holdem_call',
        });
        await syncCasinoTableRuntime(updated);
        await interaction.update(buildCasinoTableMessage(updated));
      },
    },
    {
      match: interaction.customId.match(/^casino:table:holdem:raise:(.+)$/),
      handler: async (tableId) => {
        const modal = new ModalBuilder()
          .setCustomId(casinoTableHoldemRaiseModalCustomId(tableId))
          .setTitle('Raise In Hold\'em');
        const amountInput = new TextInputBuilder()
          .setCustomId('raise-total')
          .setLabel('Total amount to commit this street')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('e.g. 12');
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput));
        await interaction.showModal(modal);
      },
    },
  ];

  for (const pattern of tablePatterns) {
    if (pattern.match) {
      await pattern.handler(pattern.match[1]!);
      return;
    }
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

export const handleCasinoModal = async (
  client: Client,
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  const match = interaction.customId.match(/^casino:table:holdem:raise-modal:(.+)$/);
  if (!match?.[1]) {
    throw new Error('Unknown casino modal.');
  }

  const tableId = match[1];
  const amount = Number.parseFloat(interaction.fields.getTextInputValue('raise-total'));
  const updated = await performCasinoTableAction({
    tableId,
    userId: interaction.user.id,
    action: 'holdem_raise',
    amount,
  });
  await syncCasinoTableRuntime(updated);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildCasinoStatusEmbed('Raise Submitted', `Updated **${updated.name}**.`)],
  });
  await syncCasinoTableMessage(client, tableId);
};

export const handleCasinoTableTimeout = async (
  client: Client,
  tableId: string,
): Promise<void> => {
  const updated = await advanceCasinoTableTimeout(tableId);
  if (!updated) {
    return;
  }
  await syncCasinoTableRuntime(updated);
  await syncCasinoTableMessage(client, tableId);
};
