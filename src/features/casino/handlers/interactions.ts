import {
  ActionRowBuilder,
  ChannelType,
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
  type ThreadChannel,
} from 'discord.js';

import { redis } from '../../../lib/redis.js';
import { getEffectiveEconomyAccountPreview } from '../../economy/services/accounts.js';
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
} from '../ui/custom-ids.js';
import {
  describeCasinoConfig,
  disableCasinoConfig,
  getCasinoConfig,
  setCasinoConfig,
} from '../services/config.js';
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
} from '../ui/render.js';
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
} from '../services/gameplay.js';
import {
  deleteCasinoSession,
  getCasinoSession,
  saveCasinoSession,
} from '../state/sessions.js';
import {
  buildCasinoTableListEmbed,
  buildCasinoTableMessage,
  buildCasinoTablePrivateEmbed,
} from '../multiplayer/ui/render.js';
import { performCasinoBotTurn } from '../multiplayer/bots/services/actions.js';
import { syncCasinoTableJobs } from '../multiplayer/services/scheduler.js';
import {
  advanceCasinoTableTimeout,
  attachCasinoTableMessage,
  attachCasinoTableThread,
  closeCasinoTableForNoHumanTimeout,
  closeCasinoTable,
  createCasinoTable,
  getCasinoTable,
  getCasinoTablePrivateView,
  joinCasinoTable,
  leaveCasinoTable,
  listCasinoTables,
  performCasinoTableAction,
  setCasinoTableBotCount,
  startCasinoTable,
  getCasinoTableByThreadId,
} from '../multiplayer/services/tables.js';
import type { CasinoTableSummary } from '../core/types.js';

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

const isThreadLikeChannel = (
  channel: { type: ChannelType; parentId?: string | null },
): channel is ThreadChannel =>
  channel.type === ChannelType.PublicThread
  || channel.type === ChannelType.PrivateThread
  || channel.type === ChannelType.AnnouncementThread;

const assertCasinoTableChannel = (
  interaction: ChatInputCommandInteraction,
  channelId: string,
): { parentChannelId: string; threadId: string | null } => {
  const channel = interaction.channel;
  if (!channel) {
    throw new Error('Casino tables can only be managed from a server text channel or thread.');
  }

  if (interaction.channelId === channelId) {
    return {
      parentChannelId: channelId,
      threadId: null,
    };
  }

  if (isThreadLikeChannel(channel) && channel.parentId === channelId) {
    return {
      parentChannelId: channelId,
      threadId: channel.id,
    };
  }

  throw new Error(`Casino games must be started in <#${channelId}>.`);
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

const getExplicitTableId = (interaction: ChatInputCommandInteraction): string | null =>
  interaction.options.getString('table');

const resolveTableIdFromInteraction = async (
  interaction: ChatInputCommandInteraction,
): Promise<string> => {
  const explicitTableId = getExplicitTableId(interaction);
  if (explicitTableId) {
    return explicitTableId;
  }

  const channel = interaction.channel;
  if (channel && isThreadLikeChannel(channel)) {
    const table = await getCasinoTableByThreadId(channel.id);
    if (table) {
      return table.id;
    }
  }

  throw new Error('Choose a table ID, or run this inside that table thread.');
};

const seatedSeats = (table: CasinoTableSummary): CasinoTableSummary['seats'] =>
  table.seats
    .filter((seat) => seat.status === 'seated')
    .sort((left, right) => left.seatIndex - right.seatIndex);

const resolveHumanName = async (client: Client, userId: string): Promise<string> => {
  const user = await client.users.fetch(userId).catch(() => null);
  return user?.username ?? `player-${userId.slice(-4)}`;
};

const buildCasinoTableThreadName = async (client: Client, table: CasinoTableSummary): Promise<string> => {
  const orderedSeats = seatedSeats(table);
  const hostSeat = orderedSeats.find((seat) => seat.userId === table.hostUserId);
  const otherSeats = orderedSeats.filter((seat) => seat.userId !== table.hostUserId);
  const orderedNames = [
    ...(hostSeat ? [hostSeat] : []),
    ...otherSeats,
  ];

  const rawNames = await Promise.all(orderedNames.map(async (seat) =>
    seat.isBot
      ? (seat.botName ?? 'Bot')
      : resolveHumanName(client, seat.userId)));
  const dedupedNames = [...new Set(rawNames)];
  const prefix = table.game === 'holdem' ? 'Holdem' : 'Blackjack';
  const base = `${prefix} - ${dedupedNames.join(' + ') || table.name}`;
  return base.length <= 100 ? base : `${base.slice(0, 97)}...`;
};

const fetchCasinoTableLiveChannel = async (
  client: Client,
  table: CasinoTableSummary,
) => {
  const liveChannelId = table.threadId ?? table.channelId;
  const channel = await client.channels.fetch(liveChannelId).catch(() => null);
  if (!channel?.isTextBased() || !('messages' in channel)) {
    return null;
  }

  return channel;
};

const syncCasinoTableMessage = async (client: Client, tableId: string): Promise<void> => {
  const table = await getCasinoTable(tableId);
  if (!table?.messageId) {
    return;
  }

  const channel = await fetchCasinoTableLiveChannel(client, table);
  if (!channel) {
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
  await syncCasinoTableJobs(table);
};

const syncCasinoTableThreadName = async (client: Client, tableId: string): Promise<void> => {
  const table = await getCasinoTable(tableId);
  if (!table?.threadId) {
    return;
  }

  const channel = await client.channels.fetch(table.threadId).catch(() => null);
  if (!channel || !isThreadLikeChannel(channel)) {
    return;
  }

  const nextName = await buildCasinoTableThreadName(client, table);
  if (channel.name === nextName) {
    return;
  }

  await channel.setName(nextName).catch(() => undefined);
};

const ensureCasinoTableThread = async (
  client: Client,
  table: CasinoTableSummary,
  preferredThreadId: string | null,
): Promise<string> => {
  if (table.threadId) {
    await syncCasinoTableThreadName(client, table.id);
    return table.threadId;
  }

  if (preferredThreadId) {
    await attachCasinoTableThread(table.id, preferredThreadId);
    await syncCasinoTableThreadName(client, table.id);
    return preferredThreadId;
  }

  const channel = await client.channels.fetch(table.channelId).catch(() => null);
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
    throw new Error('The configured casino channel can no longer host table threads.');
  }

  const thread = await channel.threads.create({
    name: await buildCasinoTableThreadName(client, table),
    autoArchiveDuration: 1440,
    reason: `Casino table ${table.id}`,
  }).catch(() => null);
  if (!thread) {
    throw new Error('I could not create a thread for that casino table.');
  }

  await attachCasinoTableThread(table.id, thread.id);
  return thread.id;
};

const ensureCasinoTableMessage = async (
  client: Client,
  table: CasinoTableSummary,
  preferredThreadId: string | null,
): Promise<CasinoTableSummary> => {
  const threadId = await ensureCasinoTableThread(client, table, preferredThreadId);
  const latest = await getCasinoTable(table.id);
  if (!latest) {
    throw new Error('That casino table no longer exists.');
  }

  if (!latest.messageId) {
    const thread = await client.channels.fetch(threadId).catch(() => null);
    if (!thread?.isTextBased() || !('send' in thread)) {
      throw new Error('I could not send the table into its thread.');
    }

    const message = await thread.send({
      ...buildCasinoTableMessage(latest),
      allowedMentions: {
        parse: [],
      },
    });
    await attachCasinoTableMessage(latest.id, message.id);
    const refreshed = await getCasinoTable(latest.id);
    if (!refreshed) {
      throw new Error('That casino table no longer exists.');
    }
    return refreshed;
  }

  await syncCasinoTableMessage(client, latest.id);
  await syncCasinoTableThreadName(client, latest.id);
  return latest;
};

const finalizeClosedCasinoTableThread = async (client: Client, tableId: string): Promise<void> => {
  const table = await getCasinoTable(tableId);
  if (!table?.threadId) {
    return;
  }

  const thread = await client.channels.fetch(table.threadId).catch(() => null);
  if (!thread?.isTextBased() || !('send' in thread) || !isThreadLikeChannel(thread)) {
    return;
  }

  await thread.send({
    embeds: [buildCasinoStatusEmbed('Table Finished', `**${table.name}** is finished. This thread is now closed.`)],
    allowedMentions: {
      parse: [],
    },
  }).catch(() => undefined);
  await thread.setLocked(true).catch(() => undefined);
  await thread.setArchived(true).catch(() => undefined);
};

const handleTableCreateCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
  channelContext: { parentChannelId: string; threadId: string | null },
): Promise<void> => {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });
  const game = interaction.options.getString('game', true) as 'blackjack' | 'holdem';
  const created = await createCasinoTable({
    guildId: interaction.guildId!,
    channelId: channelContext.parentChannelId,
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
    ...(interaction.options.getInteger('bot_count') !== null
      ? { botCount: interaction.options.getInteger('bot_count', true) }
      : {}),
  });

  const prepared = await ensureCasinoTableMessage(client, created, channelContext.threadId);
  await syncCasinoTableRuntime(prepared);
  await syncCasinoTableThreadName(client, prepared.id);

  const threadId = prepared.threadId;
  await interaction.editReply({
    embeds: [
      buildCasinoStatusEmbed(
        'Table Created',
        threadId
          ? `Created **${prepared.name}** in <#${threadId}>. Gameplay lives in that thread.`
          : `Created **${prepared.name}**.`,
      ),
    ],
    allowedMentions: {
      parse: [],
    },
  });
};

const handleTableJoinCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });
  const tableId = await resolveTableIdFromInteraction(interaction);
  const table = await joinCasinoTable({
    tableId,
    userId: interaction.user.id,
    ...(interaction.options.getInteger('buy_in') !== null
      ? { buyIn: interaction.options.getInteger('buy_in', true) }
      : {}),
  });
  await syncCasinoTableRuntime(table);
  await syncCasinoTableThreadName(client, table.id);
  await syncCasinoTableMessage(client, table.id);
  await interaction.editReply({
    embeds: [buildCasinoStatusEmbed('Table Joined', `You joined **${table.name}**.`)],
  });
};

const handleTableLeaveCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });
  const table = await leaveCasinoTable(interaction.options.getString('table', true), interaction.user.id);
  await syncCasinoTableRuntime(table);
  await syncCasinoTableThreadName(client, table.id);
  await syncCasinoTableMessage(client, table.id);
  await interaction.editReply({
    embeds: [buildCasinoStatusEmbed('Table Left', `You left **${table.name}**.`)],
  });
};

const handleTableStartCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });
  const table = await startCasinoTable(interaction.options.getString('table', true), interaction.user.id);
  await syncCasinoTableRuntime(table);
  await ensureCasinoTableMessage(client, table, null);
  await syncCasinoTableMessage(client, table.id);
  await interaction.editReply({
    embeds: [buildCasinoStatusEmbed('Hand Started', `Started hand ${table.currentHandNumber} at **${table.name}**.`)],
  });
};

const handleTableCloseCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });
  const table = await closeCasinoTable(interaction.options.getString('table', true), interaction.user.id);
  await syncCasinoTableRuntime(table);
  await syncCasinoTableMessage(client, table.id);
  await interaction.editReply({
    embeds: [buildCasinoStatusEmbed('Table Closed', `Closed **${table.name}**.`)],
  });
  await finalizeClosedCasinoTableThread(client, table.id);
};

const handleTableBotsCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });
  const table = await setCasinoTableBotCount(
    interaction.options.getString('table', true),
    interaction.user.id,
    interaction.options.getInteger('count', true),
  );
  await syncCasinoTableRuntime(table);
  await syncCasinoTableThreadName(client, table.id);
  await syncCasinoTableMessage(client, table.id);
  await interaction.editReply({
    embeds: [buildCasinoStatusEmbed('Bots Updated', `Updated bot seats at **${table.name}**.`)],
  });
};

const handleTableViewCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const tableId = await resolveTableIdFromInteraction(interaction);
  const view = await getCasinoTablePrivateView(tableId, interaction.user.id);
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

  if (subcommandGroup === 'table') {
    const config = await assertCasinoEnabled(interaction.guildId);
    const tableChannelContext = assertCasinoTableChannel(interaction, config.channelId);
    if (subcommand === 'create') {
      await handleTableCreateCommand(client, interaction, tableChannelContext);
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
    if (subcommand === 'bots') {
      await handleTableBotsCommand(client, interaction);
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
        await syncCasinoTableThreadName(interaction.client, updated.id);
        await interaction.update(buildCasinoTableMessage(updated));
      },
    },
    {
      match: interaction.customId.match(/^casino:table:leave:(.+)$/),
      handler: async (tableId) => {
        const updated = await leaveCasinoTable(tableId, interaction.user.id);
        await syncCasinoTableRuntime(updated);
        await syncCasinoTableThreadName(interaction.client, updated.id);
        await interaction.update(buildCasinoTableMessage(updated));
      },
    },
    {
      match: interaction.customId.match(/^casino:table:start:(.+)$/),
      handler: async (tableId) => {
        const updated = await startCasinoTable(tableId, interaction.user.id);
        await syncCasinoTableRuntime(updated);
        await ensureCasinoTableMessage(interaction.client, updated, interaction.channel?.id ?? null);
        await interaction.update(buildCasinoTableMessage(updated));
      },
    },
    {
      match: interaction.customId.match(/^casino:table:close:(.+)$/),
      handler: async (tableId) => {
        const updated = await closeCasinoTable(tableId, interaction.user.id);
        await syncCasinoTableRuntime(updated);
        await interaction.update(buildCasinoTableMessage(updated));
        await finalizeClosedCasinoTableThread(interaction.client, updated.id);
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
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });
  const updated = await performCasinoTableAction({
    tableId,
    userId: interaction.user.id,
    action: 'holdem_raise',
    amount,
  });
  await syncCasinoTableRuntime(updated);
  await interaction.editReply({
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

export const handleCasinoTableIdleClose = async (
  client: Client,
  tableId: string,
): Promise<void> => {
  const updated = await closeCasinoTableForNoHumanTimeout(tableId);
  if (!updated) {
    return;
  }
  await syncCasinoTableRuntime(updated);
  await syncCasinoTableMessage(client, tableId);
  if (updated.status === 'closed') {
    await finalizeClosedCasinoTableThread(client, tableId);
  }
};

export const handleCasinoBotAction = async (
  client: Client,
  tableId: string,
): Promise<void> => {
  await performCasinoBotTurn(client, tableId);
  const updated = await getCasinoTable(tableId);
  if (!updated) {
    return;
  }
  await syncCasinoTableRuntime(updated);
  await syncCasinoTableMessage(client, tableId);
};
