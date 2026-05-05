import { Client, GatewayIntentBits, Partials } from 'discord.js';

import { env } from './config.js';
import { prisma } from '../lib/prisma.js';
import {
  getStarboardConfig,
  isAnyEmojiStarboardMode,
  getConfiguredStarboardEmojis,
} from '../features/starboard/services/starboard.js';
import {
  deserializeStoredEmoji,
  reactionMatchesAnyEmoji,
} from '../lib/emoji.js';

type ParsedArgs = {
  apply: boolean;
  guildId: string | null;
};

const parseArgs = (argv: string[]): ParsedArgs => {
  let guildId: string | null = null;
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      apply = true;
      continue;
    }

    if (arg === '--guild') {
      guildId = argv[index + 1] ?? null;
      index += 1;
    }
  }

  return {
    apply,
    guildId,
  };
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [
      Partials.Channel,
      Partials.Message,
      Partials.Reaction,
    ],
    allowedMentions: {
      parse: [],
    },
  });

  await client.login(env.DISCORD_TOKEN);

  try {
    const where = args.guildId
      ? { guildConfig: { guildId: args.guildId } }
      : {};

    const entries = await prisma.starboardEntry.findMany({
      where,
      select: {
        id: true,
        sourceMessageId: true,
        sourceChannelId: true,
        guildConfig: {
          select: {
            guildId: true,
            starboardAllowAnyEmoji: true,
            starboardEmojis: true,
            starboardEmojiId: true,
            starboardEmojiName: true,
          },
        },
      },
    });

    console.log(`Found ${entries.length} starboard entry(ies) to process.`);

    let processed = 0;
    let created = 0;
    let failed = 0;

    for (const entry of entries) {
      try {
        const channel = await client.channels.fetch(entry.sourceChannelId).catch(() => null);
        if (!channel?.isTextBased() || !('messages' in channel)) {
          console.warn(`[skip] Channel ${entry.sourceChannelId} not found or not text-based.`);
          continue;
        }

        const message = await channel.messages.fetch(entry.sourceMessageId).catch(() => null);
        if (!message) {
          console.warn(`[skip] Message ${entry.sourceMessageId} not found.`);
          continue;
        }

        const config = entry.guildConfig;
        const anyEmojiMode = config.starboardAllowAnyEmoji;
        const configuredEmojis = anyEmojiMode
          ? []
          : config.starboardEmojis.length > 0
            ? config.starboardEmojis
            : config.starboardEmojiName
              ? [`${config.starboardEmojiId ? 'c' : 'u'}:${encodeURIComponent(config.starboardEmojiId ?? '')}:${encodeURIComponent(config.starboardEmojiName)}`]
              : [];

        const parsedConfiguredEmojis = configuredEmojis.map((value) => {
          const emoji = deserializeStoredEmoji(value);
          return { id: emoji.id, name: emoji.name };
        });

        for (const reaction of message.reactions.cache.values()) {
          if (!anyEmojiMode && !reactionMatchesAnyEmoji(reaction.emoji, parsedConfiguredEmojis)) {
            continue;
          }

          const users = await reaction.users.fetch();
          for (const user of users.values()) {
            if (user.bot) continue;

            const emojiName = reaction.emoji.name ?? reaction.emoji.toString() ?? 'emoji';
            created += 1;

            if (args.apply) {
              await prisma.starboardReaction.upsert({
                where: {
                  guildId_sourceMessageId_userId_emojiId_emojiName: {
                    guildId: config.guildId,
                    sourceMessageId: message.id,
                    userId: user.id,
                    emojiId: reaction.emoji.id ?? '',
                    emojiName,
                  },
                },
                create: {
                  guildId: config.guildId,
                  sourceMessageId: message.id,
                  userId: user.id,
                  emojiId: reaction.emoji.id ?? '',
                  emojiName,
                },
                update: {},
              });
            }
          }
        }

        processed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[error] Entry ${entry.id}:`, error);
      }
    }

    if (args.apply) {
      console.log(`Backfill complete. Processed ${processed} entries. Created ${created} reaction records. Failed ${failed}.`);
    } else {
      console.log(`Dry run complete. Processed ${processed} entries. Would create ~${created} reaction records. Failed ${failed}. Pass --apply to persist.`);
    }
  } finally {
    client.destroy();
  }
};

main()
  .catch((error) => {
    console.error('Starboard reaction backfill failed.');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
