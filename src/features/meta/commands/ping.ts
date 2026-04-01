import os from 'node:os';
import process from 'node:process';

import { EmbedBuilder, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';

import { env } from '../../../app/config.js';

const regionLabel = 'Hillsboro, Oregon';

const formatBytes = (value: number): string => {
  if (value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const normalized = value / 1024 ** index;
  return `${normalized.toFixed(normalized >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const formatDuration = (valueSeconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(valueSeconds));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return [
    days > 0 ? `${days}d` : null,
    hours > 0 || days > 0 ? `${hours}h` : null,
    minutes > 0 || hours > 0 || days > 0 ? `${minutes}m` : null,
    `${seconds}s`,
  ]
    .filter(Boolean)
    .join(' ');
};

const formatPercent = (numerator: number, denominator: number): string => {
  if (denominator <= 0) {
    return '0.0%';
  }

  return `${((numerator / denominator) * 100).toFixed(1)}%`;
};

export const pingCommand = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Show bot health, runtime, and container status.');

export const handlePingCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  const startedAt = Date.now();
  const gatewayLatency = Math.max(0, Math.round(interaction.client.ws.ping));
  const memory = process.memoryUsage();
  const resourceUsage = process.resourceUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const replyLatency = Math.max(0, Date.now() - startedAt);
  const loadAverage = os.loadavg().map((value) => value.toFixed(2)).join(' / ');
  const containerId = process.env.HOSTNAME ?? 'unknown';
  const appRevision = env.APP_REVISION ?? 'unknown';

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [
      new EmbedBuilder()
        .setTitle('Pong')
        .setColor(0x5eead4)
        .addFields(
          {
            name: 'Network',
            value: [
              `Gateway latency: ${gatewayLatency}ms`,
              `Reply latency: ${replyLatency}ms`,
              `Region: ${regionLabel}`,
            ].join('\n'),
          },
          {
            name: 'Process',
            value: [
              `Uptime: ${formatDuration(process.uptime())}`,
              `RSS: ${formatBytes(memory.rss)}`,
              `Heap: ${formatBytes(memory.heapUsed)} / ${formatBytes(memory.heapTotal)}`,
              `CPU time: ${(resourceUsage.userCPUTime + resourceUsage.systemCPUTime) / 1_000}ms`,
            ].join('\n'),
          },
          {
            name: 'Host',
            value: [
              `Platform: ${os.platform()} ${os.release()}`,
              `Load average: ${loadAverage}`,
              `Memory: ${formatBytes(usedMemory)} / ${formatBytes(totalMemory)} (${formatPercent(usedMemory, totalMemory)})`,
              `CPUs: ${os.cpus().length}`,
            ].join('\n'),
          },
          {
            name: 'Container',
            value: [
              `Container ID: ${containerId}`,
              `App revision: ${appRevision}`,
              `Node: ${process.version}`,
              `PID: ${process.pid}`,
            ].join('\n'),
          },
        )
        .setFooter({
          text: 'Status snapshot captured at reply time.',
        }),
    ],
  });
};
