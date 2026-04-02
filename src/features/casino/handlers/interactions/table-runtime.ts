import { ChannelType, type Client } from 'discord.js';

import type { CasinoTableSummary } from '../../core/types.js';
import { buildCasinoStatusEmbed } from '../../ui/render.js';
import { syncCasinoTableJobs } from '../../multiplayer/services/scheduler.js';
import { buildCasinoTableMessage } from '../../multiplayer/ui/render.js';
import {
  attachCasinoTableMessage,
  attachCasinoTableThread,
  getCasinoTable,
} from '../../multiplayer/services/tables/queries.js';
import { isThreadLikeChannel } from './shared.js';

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

export const syncCasinoTableMessage = async (client: Client, tableId: string): Promise<void> => {
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

export const syncCasinoTableRuntime = async (table: CasinoTableSummary): Promise<void> => {
  await syncCasinoTableJobs(table);
};

export const syncCasinoTableThreadName = async (client: Client, tableId: string): Promise<void> => {
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

export const ensureCasinoTableMessage = async (
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

export const finalizeClosedCasinoTableThread = async (client: Client, tableId: string): Promise<void> => {
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
