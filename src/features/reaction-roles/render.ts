import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { buildFeedbackEmbed } from '../polls/poll-embeds.js';
import type { ReactionRoleDraft } from './draft-store.js';
import type { ReactionRolePanelWithOptions } from './types.js';

export const reactionRoleSelectCustomId = (panelId: string): string => `reaction-role:select:${panelId}`;
export const reactionRoleClearCustomId = (panelId: string): string => `reaction-role:clear:${panelId}`;
export const reactionRoleManageCustomId = (panelId: string): string => `reaction-role:manage:${panelId}`;
export const reactionRoleBuilderButtonCustomId = (
  action: 'title' | 'description' | 'roles' | 'exclusive' | 'publish' | 'cancel',
): string => `reaction-role-builder:${action}`;
export const reactionRoleBuilderModalCustomId = (
  field: 'title' | 'description' | 'roles',
): string => `reaction-role-builder:modal:${field}`;

export const buildReactionRolePanelMessage = (
  panel: ReactionRolePanelWithOptions,
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<ButtonBuilder>];
  allowedMentions: {
    parse: [];
  };
} => {
  const embed = new EmbedBuilder()
    .setTitle(panel.title)
    .setDescription(panel.description ?? 'Choose the roles you want from the menu below.')
    .setColor(0x60a5fa)
    .addFields(
      {
        name: 'Roles',
        value: panel.options.map((option) => `<@&${option.roleId}>`).join('\n'),
      },
      {
        name: 'Mode',
        value: panel.exclusive ? 'Choose one role at a time.' : 'Open the role manager to add or remove multiple roles.',
      },
      {
        name: 'How It Works',
        value: 'Use **Manage Roles** below. Your current roles are pre-selected in the private selector.',
      },
    )
    .setFooter({
      text: `Panel ID: ${panel.id}`,
    });

  const manage = new ButtonBuilder()
    .setCustomId(reactionRoleManageCustomId(panel.id))
    .setLabel('Manage Roles')
    .setStyle(ButtonStyle.Primary);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(manage)],
    allowedMentions: {
      parse: [],
    },
  };
};

export const buildReactionRoleSelectionMessage = (
  panel: ReactionRolePanelWithOptions,
  selectedOptionIds: string[],
  status?: string,
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<StringSelectMenuBuilder>, ActionRowBuilder<ButtonBuilder>];
  allowedMentions: {
    parse: [];
  };
} => {
  const selected = new Set(selectedOptionIds);
  const selectedRoles = panel.options
    .filter((option) => selected.has(option.id))
    .map((option) => `<@&${option.roleId}>`);

  const embed = new EmbedBuilder()
    .setTitle(`Manage Roles: ${panel.title}`)
    .setDescription(panel.description ?? 'Select the roles you want to hold from this panel.')
    .setColor(status ? 0x5eead4 : 0x60a5fa)
    .addFields(
      {
        name: 'Current Roles',
        value: selectedRoles.join(', ') || 'No panel roles selected right now.',
      },
      {
        name: 'Mode',
        value: panel.exclusive
          ? 'Choose exactly one role from this panel.'
          : 'Select the full set of roles you want to keep from this panel.',
      },
    )
    .setFooter({
      text: status ?? 'Your current roles are pre-selected below.',
    });

  const select = new StringSelectMenuBuilder()
    .setCustomId(reactionRoleSelectCustomId(panel.id))
    .setPlaceholder(panel.exclusive ? 'Choose one role' : 'Choose the roles you want to keep')
    .setMinValues(0)
    .setMaxValues(panel.exclusive ? 1 : panel.options.length)
    .addOptions(
      panel.options.map((option) => ({
        label: option.label,
        value: option.id,
        description: selected.has(option.id) ? `Currently has ${option.label}` : `Add ${option.label}`,
        default: selected.has(option.id),
      })),
    );

  const clear = new ButtonBuilder()
    .setCustomId(reactionRoleClearCustomId(panel.id))
    .setLabel('Clear My Panel Roles')
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(clear),
    ],
    allowedMentions: {
      parse: [],
    },
  };
};

export const buildReactionRoleStatusEmbed = (title: string, description: string, color = 0x60a5fa): EmbedBuilder =>
  buildFeedbackEmbed(title, description, color);

export const buildReactionRoleBuilderPreview = (
  draft: ReactionRoleDraft,
  error?: string,
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<ButtonBuilder>, ActionRowBuilder<ButtonBuilder>];
  allowedMentions: {
    parse: [];
  };
} => {
  const embed = new EmbedBuilder()
    .setTitle('Reaction Role Draft')
    .setDescription(
      [
        draft.description || '*No description yet*',
        '',
        `**Title** ${draft.title}`,
        `**Roles** ${draft.roleTargets || '*No roles configured yet*'}`,
        `**Mode** ${draft.exclusive ? 'Exclusive, one role at a time' : 'Multi-select'}`,
      ].join('\n'),
    )
    .setColor(error ? 0xef4444 : 0x60a5fa)
    .setFooter({
      text: error ? error : 'Edit the draft, then publish it to the current channel.',
    });

  const rowOne = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(reactionRoleBuilderButtonCustomId('title'))
      .setLabel('Title')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(reactionRoleBuilderButtonCustomId('description'))
      .setLabel('Description')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(reactionRoleBuilderButtonCustomId('roles'))
      .setLabel('Roles')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(reactionRoleBuilderButtonCustomId('exclusive'))
      .setLabel(draft.exclusive ? 'Exclusive: On' : 'Exclusive: Off')
      .setStyle(ButtonStyle.Secondary),
  );

  const rowTwo = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(reactionRoleBuilderButtonCustomId('publish'))
      .setLabel('Publish')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(reactionRoleBuilderButtonCustomId('cancel'))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  return {
    embeds: [embed],
    components: [rowOne, rowTwo],
    allowedMentions: {
      parse: [],
    },
  };
};

export const buildReactionRoleBuilderModal = (
  field: 'title' | 'description' | 'roles',
  draft: ReactionRoleDraft,
): ModalBuilder => {
  const input = new TextInputBuilder().setCustomId('value');

  switch (field) {
    case 'title':
      input
        .setLabel('Panel Title')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(draft.title)
        .setMaxLength(100);
      break;
    case 'description':
      input
        .setLabel('Description')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setValue(draft.description)
        .setMaxLength(1000);
      break;
    case 'roles':
      input
        .setLabel('Roles')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setValue(draft.roleTargets)
        .setPlaceholder('Comma-separated role mentions or IDs')
        .setMaxLength(1000);
      break;
  }

  return new ModalBuilder()
    .setCustomId(reactionRoleBuilderModalCustomId(field))
    .setTitle(`Edit ${field}`)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
};
