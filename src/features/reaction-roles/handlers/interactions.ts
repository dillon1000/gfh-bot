import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { buildFeedbackEmbed } from '../../../lib/feedback-embeds.js';
import { deleteReactionRoleDraft, getReactionRoleDraft, saveReactionRoleDraft } from '../state/drafts.js';
import { parseRoleTargets } from '../parsing/parser.js';
import {
  buildReactionRolePanelMessage,
  buildReactionRoleBuilderModal,
  buildReactionRoleBuilderPreview,
  buildReactionRoleSelectionMessage,
  buildReactionRoleStatusEmbed,
  reactionRoleBuilderButtonCustomId,
  reactionRoleBuilderModalCustomId,
  reactionRoleClearCustomId,
  reactionRoleManageCustomId,
  reactionRoleSelectCustomId,
} from '../ui/render.js';
import {
  applyReactionRoleSelection,
  clearReactionRoleSelection,
  createReactionRolePanelRecord,
  deleteReactionRolePanel,
  describeReactionRolePanel,
  getReactionRolePanelByQuery,
  getSelectedReactionRoleOptionIds,
  handleReactionRoleError,
  listReactionRolePanels,
  publishReactionRolePanel,
  validateReactionRoleTargets,
} from '../services/panels.js';
import { redis } from '../../../lib/redis.js';

const publishReactionRoleDraft = async (
  client: Client,
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  draft: {
    title: string;
    description: string;
    roleTargets: string;
    exclusive: boolean;
  },
): Promise<{ messageId: string; panelId: string }> => {
  if (!interaction.inGuild() || !interaction.channelId) {
    throw new Error('Reaction role panels can only be created in guild text channels.');
  }

  const guild = interaction.guild;
  if (!guild) {
    throw new Error('Reaction role panels can only be created in guild text channels.');
  }

  const member = await guild.members.fetch(interaction.user.id);
  const roleTargets = parseRoleTargets(draft.roleTargets);
  const roles = await validateReactionRoleTargets(member, roleTargets);
  const panel = await createReactionRolePanelRecord({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    title: draft.title.trim(),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    exclusive: draft.exclusive,
    createdById: interaction.user.id,
    roles,
  });
  const published = await publishReactionRolePanel(client, panel);

  return {
    messageId: published.messageId,
    panelId: panel.id,
  };
};

export const handleReactionRolesCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Reaction role commands can only be used in a server.');
  }
  const guild = interaction.guild;
  if (!guild) {
    throw new Error('Reaction role commands can only be used in a server.');
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'create': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const channel = interaction.options.getChannel('channel', true);
      const title = interaction.options.getString('title', true).trim();
      const description = interaction.options.getString('description')?.trim() ?? '';
      const exclusive = interaction.options.getBoolean('exclusive') ?? false;
      const roleTargets = parseRoleTargets(interaction.options.getString('roles', true));

      if (!('isTextBased' in channel) || !channel.isTextBased()) {
        throw new Error('Reaction role panels must be posted in a text-based channel.');
      }

      const member = await guild.members.fetch(interaction.user.id);
      const roles = await validateReactionRoleTargets(member, roleTargets);
      const panel = await createReactionRolePanelRecord({
        guildId: interaction.guildId,
        channelId: channel.id,
        title,
        ...(description ? { description } : {}),
        exclusive,
        createdById: interaction.user.id,
        roles,
      });
      const published = await publishReactionRolePanel(client, panel);

      await interaction.editReply({
        embeds: [
          buildReactionRoleStatusEmbed(
            'Reaction Role Panel Created',
            `Posted **${panel.title}** in <#${panel.channelId}>.\nMessage ID: ${published.messageId}\nPanel ID: ${panel.id}`,
          ),
        ],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    case 'list': {
      const panels = await listReactionRolePanels(interaction.guildId);

      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        embeds: [
          buildReactionRoleStatusEmbed(
            'Reaction Role Panels',
            panels.length === 0
              ? 'No reaction role panels are configured in this server.'
              : panels.map((panel, index) => `${index + 1}.\n${describeReactionRolePanel(panel)}`).join('\n\n'),
          ),
        ],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    case 'delete': {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const query = interaction.options.getString('query', true);
      const panel = await getReactionRolePanelByQuery(query, interaction.guildId);
      if (!panel) {
        throw new Error('Reaction role panel not found.');
      }

      await deleteReactionRolePanel(client, panel);
      await interaction.editReply({
        embeds: [
          buildReactionRoleStatusEmbed(
            'Reaction Role Panel Deleted',
            `Deleted **${panel.title}**.`,
            0xef4444,
          ),
        ],
      });
      return;
    }
    default:
      throw new Error('Unknown reaction role subcommand.');
  }
};

export const handleReactionRoleBuilderCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Reaction role builder only works inside a server.');
  }

  const draft = await getReactionRoleDraft(redis, interaction.guildId, interaction.user.id);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...buildReactionRoleBuilderPreview(draft),
  });
};

const updateReactionRoleBuilderPreview = async (
  interaction: ButtonInteraction | ModalSubmitInteraction,
  error?: string,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Reaction role builder only works inside a server.');
  }

  const draft = await getReactionRoleDraft(redis, interaction.guildId, interaction.user.id);
  const preview = buildReactionRoleBuilderPreview(draft, error);

  if (interaction.isModalSubmit() && interaction.isFromMessage()) {
    await interaction.update(preview);
    return;
  }

  if (interaction.isButton()) {
    await interaction.update(preview);
    return;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...preview,
  });
};

export const handleReactionRoleBuilderButton = async (
  client: Client,
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Reaction role builder only works inside a server.');
  }

  const draft = await getReactionRoleDraft(redis, interaction.guildId, interaction.user.id);

  switch (interaction.customId) {
    case reactionRoleBuilderButtonCustomId('title'):
      await interaction.showModal(buildReactionRoleBuilderModal('title', draft));
      return;
    case reactionRoleBuilderButtonCustomId('description'):
      await interaction.showModal(buildReactionRoleBuilderModal('description', draft));
      return;
    case reactionRoleBuilderButtonCustomId('roles'):
      await interaction.showModal(buildReactionRoleBuilderModal('roles', draft));
      return;
    case reactionRoleBuilderButtonCustomId('exclusive'):
      draft.exclusive = !draft.exclusive;
      await saveReactionRoleDraft(redis, interaction.guildId, interaction.user.id, draft);
      await updateReactionRoleBuilderPreview(interaction);
      return;
    case reactionRoleBuilderButtonCustomId('publish'): {
      await interaction.deferUpdate();
      const published = await publishReactionRoleDraft(client, interaction, draft);
      await deleteReactionRoleDraft(redis, interaction.guildId, interaction.user.id);
      await interaction.editReply({
        embeds: [
          buildReactionRoleStatusEmbed(
            'Reaction Role Panel Created',
            `Posted **${draft.title}** in <#${interaction.channelId}>.\nMessage ID: ${published.messageId}\nPanel ID: ${published.panelId}`,
          ),
        ],
        components: [],
        allowedMentions: {
          parse: [],
        },
      });
      return;
    }
    case reactionRoleBuilderButtonCustomId('cancel'):
      await deleteReactionRoleDraft(redis, interaction.guildId, interaction.user.id);
      await interaction.update({
        embeds: [buildReactionRoleStatusEmbed('Reaction Role Builder Cancelled', 'The draft has been discarded.', 0xef4444)],
        components: [],
      });
      return;
    default:
      return;
  }
};

export const handleReactionRoleBuilderModal = async (
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Reaction role builder only works inside a server.');
  }

  const draft = await getReactionRoleDraft(redis, interaction.guildId, interaction.user.id);
  const value = interaction.fields.getTextInputValue('value').trim();

  switch (interaction.customId) {
    case reactionRoleBuilderModalCustomId('title'):
      draft.title = value;
      break;
    case reactionRoleBuilderModalCustomId('description'):
      draft.description = value;
      break;
    case reactionRoleBuilderModalCustomId('roles'):
      draft.roleTargets = value;
      break;
    default:
      return;
  }

  await saveReactionRoleDraft(redis, interaction.guildId, interaction.user.id, draft);
  await updateReactionRoleBuilderPreview(interaction);
};

export const handleReactionRoleSelect = async (
  interaction: StringSelectMenuInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Reaction role panels can only be used in a server.');
  }
  const guild = interaction.guild;
  if (!guild) {
    throw new Error('Reaction role panels can only be used in a server.');
  }

  const panelId = interaction.customId.split(':')[2];
  if (!panelId) {
    throw new Error('Invalid reaction role panel identifier.');
  }

  const member = await guild.members.fetch(interaction.user.id);
  const result = await applyReactionRoleSelection(panelId, member, interaction.values);
  const refreshedMember = await guild.members.fetch(interaction.user.id);
  const selectedOptionIds = getSelectedReactionRoleOptionIds(result.panel, refreshedMember);
  const status = [
    result.addedRoleIds.length > 0 ? `Added: ${result.addedRoleIds.map((roleId) => `<@&${roleId}>`).join(', ')}` : null,
    result.removedRoleIds.length > 0 ? `Removed: ${result.removedRoleIds.map((roleId) => `<@&${roleId}>`).join(', ')}` : null,
    result.addedRoleIds.length === 0 && result.removedRoleIds.length === 0 ? 'No role changes were needed.' : null,
  ].filter(Boolean).join('\n');

  await interaction.update(buildReactionRoleSelectionMessage(result.panel, selectedOptionIds, status));
};

export const handleReactionRoleManage = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Reaction role panels can only be used in a server.');
  }
  const guild = interaction.guild;
  if (!guild) {
    throw new Error('Reaction role panels can only be used in a server.');
  }

  const panelId = interaction.customId.split(':')[2];
  if (!panelId) {
    throw new Error('Invalid reaction role panel identifier.');
  }

  const panel = await getReactionRolePanelByQuery(panelId, interaction.guildId);
  if (!panel) {
    throw new Error('Reaction role panel not found.');
  }

  const member = await guild.members.fetch(interaction.user.id);
  const selectedOptionIds = getSelectedReactionRoleOptionIds(panel, member);

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    ...buildReactionRoleSelectionMessage(panel, selectedOptionIds),
  });
};

export const handleReactionRoleClear = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  if (!interaction.inGuild()) {
    throw new Error('Reaction role panels can only be used in a server.');
  }
  const guild = interaction.guild;
  if (!guild) {
    throw new Error('Reaction role panels can only be used in a server.');
  }

  const panelId = interaction.customId.split(':')[2];
  if (!panelId) {
    throw new Error('Invalid reaction role panel identifier.');
  }

  const member = await guild.members.fetch(interaction.user.id);
  const result = await clearReactionRoleSelection(panelId, member);

  await interaction.update(
    buildReactionRoleSelectionMessage(
      result.panel,
      [],
      result.removedRoleIds.length > 0
        ? `Removed: ${result.removedRoleIds.map((roleId) => `<@&${roleId}>`).join(', ')}`
        : 'You did not currently hold any panel roles.',
    ),
  );
};

export const handleReactionRoleInteractionError = async (
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction | ButtonInteraction | ModalSubmitInteraction,
  error: unknown,
): Promise<void> => {
  handleReactionRoleError(error);
  const message = error instanceof Error ? error.message : 'Something went wrong.';

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      embeds: [buildFeedbackEmbed('Reaction Roles Error', message, 0xef4444)],
    }).catch(() => undefined);
    return;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [buildFeedbackEmbed('Reaction Roles Error', message, 0xef4444)],
  }).catch(() => undefined);
};
