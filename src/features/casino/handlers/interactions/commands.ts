import { MessageFlags, type ChatInputCommandInteraction, type Client } from 'discord.js';

import { getEffectiveEconomyAccountPreview } from '../../../../lib/economy.js';
import {
  buildCasinoBalanceEmbed,
  buildCasinoStatsEmbed,
  buildCasinoStatusEmbed,
  buildBlackjackPrompt,
  buildBlackjackResultEmbed,
  buildPokerPrompt,
  buildRtdResultEmbed,
  buildSlotsResultEmbed,
} from '../../ui/render.js';
import {
  describeCasinoConfig,
  disableCasinoConfig,
  getCasinoConfig,
  setCasinoConfig,
} from '../../services/config.js';
import {
  getCasinoStatsSummary,
  playRtd,
  playSlots,
  startBlackjack,
  startPoker,
} from '../../services/gameplay.js';
import { saveCasinoSession } from '../../state/sessions.js';
import { redis } from '../../../../lib/redis.js';
import {
  buildCasinoTableListEmbed,
  buildCasinoTablePrivateEmbed,
} from '../../multiplayer/ui/render.js';
import {
  createCasinoTable,
  getCasinoTablePrivateView,
  listCasinoTables,
} from '../../multiplayer/services/tables/queries.js';
import {
  joinCasinoTable,
  leaveCasinoTable,
  setCasinoTableBotCount,
} from '../../multiplayer/services/tables/seating.js';
import {
  closeCasinoTable,
} from '../../multiplayer/services/tables/admin.js';
import { startCasinoTable } from '../../multiplayer/services/tables/start.js';
import {
  assertCasinoChannel,
  assertCasinoEnabled,
  assertCasinoTableChannel,
  assertManageGuild,
  assertNoActiveSession,
  getRequiredWager,
  resolveTableIdFromInteraction,
} from './shared.js';
import {
  ensureCasinoTableMessage,
  finalizeClosedCasinoTableThread,
  syncCasinoTableMessage,
  syncCasinoTableRuntime,
  syncCasinoTableThreadName,
} from './table-runtime.js';

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
