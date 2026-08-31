import type { Client, Interaction } from 'discord.js';

import { getRequestID } from '@/app/observability.js';
import { traceOperation } from '@/app/trace.js';

const requestFooterPrefix = 'Request ID: ';
const embedFooterLimit = 2_048;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const addRequestIDToEmbed = (
  embed: Record<string, unknown>,
  requestID: string,
): Record<string, unknown> => {
  const footer = isRecord(embed.footer) ? embed.footer : {};
  const previousText = typeof footer.text === 'string' ? footer.text : '';
  const textWithoutRequestID = previousText
    .replace(/(?:\n)?Request ID: \S+$/u, '')
    .trimEnd();
  const marker = `${requestFooterPrefix}${requestID}`;
  const separator = textWithoutRequestID ? '\n' : '';
  const availableTextLength = embedFooterLimit - separator.length - marker.length;
  const footerText = `${textWithoutRequestID.slice(0, availableTextLength)}${separator}${marker}`;

  return {
    ...embed,
    footer: {
      ...footer,
      text: footerText,
    },
  };
};

/** Adds the active request ID to direct message payloads and interaction callback data. */
export const addRequestIDToEmbeds = (body: unknown, requestID: string): unknown => {
  if (!isRecord(body)) {
    return body;
  }

  const embeds = Array.isArray(body.embeds)
    ? body.embeds.map((embed) => isRecord(embed) ? addRequestIDToEmbed(embed, requestID) : embed)
    : body.embeds;
  const data = isRecord(body.data) ? addRequestIDToEmbeds(body.data, requestID) : body.data;

  if (embeds === body.embeds && data === body.data) {
    return body;
  }

  return {
    ...body,
    ...(embeds !== undefined ? { embeds } : {}),
    ...(data !== undefined ? { data } : {}),
  };
};

export const getInteractionTraceDetails = (
  interaction: Interaction,
): { name: string; attributes: Record<string, string> } => {
  let kind = 'unknown';
  let target = 'unknown';

  if (interaction.isChatInputCommand()) {
    kind = 'command';
    target = interaction.commandName;
  } else if (interaction.isMessageContextMenuCommand()) {
    kind = 'context-menu';
    target = interaction.commandName;
  } else if (interaction.isButton()) {
    kind = 'button';
    target = interaction.customId.split(':').slice(0, 2).join(':');
  } else if (interaction.isAnySelectMenu()) {
    kind = 'select';
    target = interaction.customId.split(':').slice(0, 2).join(':');
  } else if (interaction.isModalSubmit()) {
    kind = 'modal';
    target = interaction.customId.split(':').slice(0, 2).join(':');
  }

  return {
    name: `discord.interaction.${kind}.${target}`,
    attributes: {
      'discord.interaction.id': interaction.id ?? 'unknown',
      'discord.interaction.kind': kind,
      'discord.interaction.target': target,
      'discord.user.id': interaction.user?.id ?? 'unknown',
      ...(interaction.guildId ? { 'discord.guild.id': interaction.guildId } : {}),
      ...(interaction.channelId ? { 'discord.channel.id': interaction.channelId } : {}),
    },
  };
};

/** Replaces Discord route credentials before attributes leave the process. */
export const redactDiscordRoute = (route: string): string =>
  route
    .replace(/^\/interactions\/[^/]+\/[^/]+/u, '/interactions/:id/:token')
    .replace(/^\/webhooks\/[^/]+\/[^/?]+/u, '/webhooks/:id/:token');

/** Traces all Discord REST calls and decorates every outgoing embed with its request ID. */
export const instrumentDiscordREST = (client: Client): void => {
  if (!client.rest?.request) {
    return;
  }

  const request = client.rest.request.bind(client.rest);

  client.rest.request = (options) =>
    traceOperation(
      'discord.rest.request',
      {
        'http.request.method': options.method,
        'url.route': redactDiscordRoute(options.fullRoute),
      },
      () => {
        const requestID = getRequestID();
        return request({
          ...options,
          body: requestID ? addRequestIDToEmbeds(options.body, requestID) : options.body,
        });
      },
    );
};
