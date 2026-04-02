import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
} from 'discord.js';

import { redis } from '../../../../lib/redis.js';
import { casinoTableHoldemRaiseModalCustomId } from '../../ui/custom-ids.js';
import {
  buildBlackjackPrompt,
  buildBlackjackResultEmbed,
  buildCasinoStatusEmbed,
  buildPokerResultEmbed,
} from '../../ui/render.js';
import {
  drawPoker,
  hitBlackjack,
  standBlackjack,
} from '../../services/gameplay.js';
import {
  deleteCasinoSession,
  getCasinoSession,
  saveCasinoSession,
} from '../../state/sessions.js';
import {
  buildCasinoTableMessage,
  buildCasinoTablePrivateEmbed,
} from '../../multiplayer/ui/render.js';
import {
  getCasinoTablePrivateView,
} from '../../multiplayer/services/tables/queries.js';
import {
  joinCasinoTable,
  leaveCasinoTable,
} from '../../multiplayer/services/tables/seating.js';
import { closeCasinoTable } from '../../multiplayer/services/tables/admin.js';
import { startCasinoTable } from '../../multiplayer/services/tables/start.js';
import { performCasinoTableAction } from '../../multiplayer/services/tables/actions.js';
import {
  assertSessionOwner,
  getGuildIdFromInteraction,
  parseOwnerCustomId,
} from './shared.js';
import {
  ensureCasinoTableMessage,
  finalizeClosedCasinoTableThread,
  syncCasinoTableRuntime,
  syncCasinoTableThreadName,
} from './table-runtime.js';

const replyWithExpiredGame = async (
  interaction: ButtonInteraction,
  label: string,
): Promise<void> => {
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildCasinoStatusEmbed('Game Expired', `That ${label} has expired.`, 0xef4444)],
  });
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
      await replyWithExpiredGame(interaction, 'blackjack hand');
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
      await replyWithExpiredGame(interaction, 'blackjack hand');
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
      await replyWithExpiredGame(interaction, 'poker hand');
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
