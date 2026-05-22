import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { formatDurationFromMinutes } from '@/lib/duration.js';
import {
  pollBuilderButtonCustomId,
  pollBuilderModalCustomId,
  pollBuilderSelectCustomId,
  type PollBuilderModalField,
} from '@/features/polls/ui/custom-ids.js';
import { getPollChoiceEmojiDisplay, resolvePollThreadName } from '@/features/polls/ui/present.js';
import { getModeLabel } from '@/features/polls/ui/render-helpers.js';
import {
  DEFAULT_TIER_LABELS,
  type PollBuilderStep,
  type PollDraft,
  type PollMode,
} from '@/features/polls/core/types.js';

const ACCENT_COLOR = 0x5eead4;
const ACCENT_ERROR = 0xef4444;

const STEP_ORDER: PollBuilderStep[] = ['mode', 'content', 'timing', 'advanced'];

const STEP_TITLES: Record<PollBuilderStep, string> = {
  mode: 'Mode',
  content: 'Content',
  timing: 'Timing & Visibility',
  advanced: 'Advanced Settings',
};

const STEP_HINTS: Record<PollBuilderStep, string> = {
  mode: 'Pick how voters will respond. You can skip ahead and publish at any time.',
  content: 'Fill in the question and the rest of the content. Edits keep their last value.',
  timing: 'Set how long the poll runs, the discussion thread, and result visibility.',
  advanced: 'Optional governance, pass rules, and the *Other* option. Skip if you don\'t need them.',
};

const MODE_OPTIONS: Array<{ mode: PollMode; label: string; description: string }> = [
  { mode: 'single', label: 'Single choice', description: 'Voters pick exactly one option.' },
  { mode: 'multi', label: 'Multi choice', description: 'Voters can pick more than one option.' },
  { mode: 'ranked', label: 'Ranked choice', description: 'Voters rank options; instant-runoff winner.' },
  { mode: 'freeform', label: 'Freeform', description: 'Voters submit short text responses instead of options.' },
  { mode: 'tier', label: 'Tier list', description: 'Voters place each item into a tier (S/A/B/…).' },
];

export const getNextStep = (step: PollBuilderStep): PollBuilderStep | null => {
  const index = STEP_ORDER.indexOf(step);
  return index === -1 || index === STEP_ORDER.length - 1 ? null : STEP_ORDER[index + 1] ?? null;
};

export const getPreviousStep = (step: PollBuilderStep): PollBuilderStep | null => {
  const index = STEP_ORDER.indexOf(step);
  return index <= 0 ? null : STEP_ORDER[index - 1] ?? null;
};

const truncate = (value: string, max = 90): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

const getContentEntryLabel = (mode: PollMode): string => mode === 'tier' ? 'Items' : 'Choices';
const getContentEntrySingular = (mode: PollMode): string => mode === 'tier' ? 'Item' : 'Choice';
const getContentEntryUnit = (mode: PollMode): string => mode === 'tier' ? 'item' : 'choice';
const getPrivateVoteLabel = (mode: PollMode): string => {
  switch (mode) {
    case 'freeform':
      return 'responses';
    case 'ranked':
      return 'rankings';
    case 'tier':
      return 'tier placements';
    case 'multi':
    case 'single':
      return 'choices';
  }
};

const buildStepHeader = (draft: PollDraft): string => {
  const index = STEP_ORDER.indexOf(draft.step);
  const stepNumber = index === -1 ? 1 : index + 1;
  return `### Poll Draft — Step ${stepNumber} of ${STEP_ORDER.length} · ${STEP_TITLES[draft.step]}`;
};

const sectionWithEdit = (
  text: string,
  action: Parameters<typeof pollBuilderButtonCustomId>[0],
  options: { label?: string; style?: ButtonStyle; disabled?: boolean } = {},
): SectionBuilder =>
  new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(pollBuilderButtonCustomId(action))
        .setLabel(options.label ?? 'Edit')
        .setStyle(options.style ?? ButtonStyle.Secondary)
        .setDisabled(options.disabled ?? false),
    );

const sectionWithToggle = (
  text: string,
  action: Parameters<typeof pollBuilderButtonCustomId>[0],
  isOn: boolean,
  disabled = false,
): SectionBuilder =>
  new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(pollBuilderButtonCustomId(action))
        .setLabel(isOn ? 'Turn off' : 'Turn on')
        .setStyle(isOn ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(disabled),
    );

const renderChoicesPreview = (draft: PollDraft): string => {
  if (draft.mode === 'freeform') {
    return '*Freeform polls collect short text responses instead of fixed options.*';
  }
  const list = draft.choices
    .map((choice, index) => `${getPollChoiceEmojiDisplay(draft.choiceEmojis[index] ?? null, index)} ${choice}`)
    .join(' · ');
  return draft.allowOtherOption ? `${list} · *Other*` : list;
};

const renderEmojiPreview = (draft: PollDraft): string => {
  if (draft.mode === 'freeform') return '*Not used in freeform polls.*';
  if (!draft.choiceEmojis.some((emoji) => emoji)) return '*Default numbered emoji.*';
  return draft.choiceEmojis.map((emoji, index) => getPollChoiceEmojiDisplay(emoji, index)).join(' · ');
};

const renderTierPreview = (draft: PollDraft): string => {
  const labels = draft.tierLabels.length > 0 ? draft.tierLabels : [...DEFAULT_TIER_LABELS];
  return labels.join(' · ');
};

const renderRemindersPreview = (draft: PollDraft): string =>
  draft.reminderOffsets.length === 0
    ? 'No reminders'
    : draft.reminderOffsets.map((minutes) => formatDurationFromMinutes(minutes)).join(', ');

const renderRolesPreview = (roleIds: string[], emptyText = '*None*'): string =>
  roleIds.length === 0 ? emptyText : roleIds.map((id) => `<@&${id}>`).join(' ');

const renderChannelsPreview = (channelIds: string[]): string =>
  channelIds.length === 0 ? '*All channels*' : channelIds.map((id) => `<#${id}>`).join(' ');

const renderPassRulePreview = (draft: PollDraft): string => {
  if (draft.mode === 'ranked' || draft.mode === 'freeform' || draft.mode === 'tier') {
    return `*Not used in ${getModeLabel(draft.mode).toLowerCase()} polls.*`;
  }
  if (!draft.passThreshold) return 'Disabled';
  const choiceLabel = draft.choices[draft.passOptionIndex ?? 0] ?? draft.choices[0] ?? 'Choice 1';
  return `**${choiceLabel}** must reach **${draft.passThreshold}%**`;
};

const buildModeSelectRow = (draft: PollDraft): ActionRowBuilder<StringSelectMenuBuilder> => {
  const select = new StringSelectMenuBuilder()
    .setCustomId(pollBuilderSelectCustomId('mode'))
    .setPlaceholder('Choose how voters will respond')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      MODE_OPTIONS.map(({ mode, label, description }) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(label)
          .setValue(mode)
          .setDescription(description)
          .setDefault(draft.mode === mode),
      ),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
};

const buildNavRow = (draft: PollDraft): ActionRowBuilder<ButtonBuilder> => {
  const buttons: ButtonBuilder[] = [];
  const previous = getPreviousStep(draft.step);
  const next = getNextStep(draft.step);

  if (previous) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(pollBuilderButtonCustomId('step-back'))
        .setLabel('◀ Back')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (next) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(pollBuilderButtonCustomId('step-next'))
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary),
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('publish'))
      .setLabel(next ? 'Skip to Publish' : 'Publish Poll')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(pollBuilderButtonCustomId('cancel'))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
};

const addModeStep = (container: ContainerBuilder, draft: PollDraft): void => {
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**Question:** ${truncate(draft.question)}\n**Current mode:** ${getModeLabel(draft.mode)}`,
    ),
  );
  container.addActionRowComponents(buildModeSelectRow(draft));
};

const addContentStep = (container: ContainerBuilder, draft: PollDraft): void => {
  container.addSectionComponents(
    sectionWithEdit(`**Question**\n${truncate(draft.question, 200)}`, 'question', { style: ButtonStyle.Primary }),
  );

  if (draft.mode === 'freeform') {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('**Responses** · *Freeform polls collect short text responses.*'),
    );
  } else {
    container.addSectionComponents(
      sectionWithEdit(`**${getContentEntryLabel(draft.mode)}**\n${renderChoicesPreview(draft)}`, 'choices', { style: ButtonStyle.Primary }),
    );
  }

  if (draft.mode === 'tier') {
    container.addSectionComponents(
      sectionWithEdit(`**Tier labels** (top → bottom)\n${renderTierPreview(draft)}`, 'tier-labels'),
    );
  }

  container.addSectionComponents(
    sectionWithEdit(
      `**Description**\n${draft.description ? truncate(draft.description, 200) : '*No description yet.*'}`,
      'description',
    ),
  );

  if (draft.mode !== 'freeform') {
    container.addSectionComponents(
      sectionWithEdit(`**${getContentEntrySingular(draft.mode)} emojis**\n${renderEmojiPreview(draft)}`, 'emojis'),
    );
  }

  if (draft.mode === 'tier') {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('-# Tier item images can be uploaded after publishing via `/poll-tier-images`.'),
    );
  }
};

const addTimingStep = (container: ContainerBuilder, draft: PollDraft): void => {
  container.addSectionComponents(
    sectionWithEdit(
      `**Duration:** ${draft.durationText}\n**Reminders:** ${renderRemindersPreview(draft)}`,
      'time',
      { style: ButtonStyle.Primary },
    ),
  );
  container.addSectionComponents(
    sectionWithToggle(
      `**Discussion thread:** ${draft.createThread ? 'Opens with the poll' : 'No thread'}`,
      'thread-toggle',
      draft.createThread,
    ),
  );
  container.addSectionComponents(
    sectionWithEdit(
      `**Thread name**\n${draft.createThread ? (draft.threadName ? truncate(draft.threadName) : `*Defaults to ${resolvePollThreadName(draft.question, draft.threadName)}*`) : '*Thread is off.*'}`,
      'thread-name',
      { disabled: !draft.createThread },
    ),
  );
  container.addSectionComponents(
    sectionWithToggle(
      `**Anonymous voting:** ${draft.anonymous ? `On — ${getPrivateVoteLabel(draft.mode)} stay private` : 'Off — voters listed publicly'}`,
      'anonymous',
      draft.anonymous,
    ),
  );
  container.addSectionComponents(
    sectionWithToggle(
      `**Live results:** ${draft.hideResultsUntilClosed ? 'Hidden until close' : 'Visible while open'}`,
      'hide-results',
      draft.hideResultsUntilClosed,
    ),
  );
};

const buildRoleSelectRow = (
  select: 'allowed-roles' | 'blocked-roles' | 'reminder-role',
  defaults: string[],
  placeholder: string,
  multi: boolean,
): ActionRowBuilder<RoleSelectMenuBuilder> => {
  const menu = new RoleSelectMenuBuilder()
    .setCustomId(pollBuilderSelectCustomId(select))
    .setPlaceholder(placeholder)
    .setMinValues(0)
    .setMaxValues(multi ? 25 : 1);
  if (defaults.length > 0) {
    menu.setDefaultRoles(multi ? defaults.slice(0, 25) : defaults.slice(0, 1));
  }
  return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(menu);
};

const buildChannelSelectRow = (
  defaults: string[],
): ActionRowBuilder<ChannelSelectMenuBuilder> => {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(pollBuilderSelectCustomId('eligible-channels'))
    .setPlaceholder('Pick channels voters must have access to (none = all)')
    .setMinValues(0)
    .setMaxValues(25)
    .addChannelTypes(
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.GuildForum,
      ChannelType.GuildVoice,
      ChannelType.GuildStageVoice,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.AnnouncementThread,
    );
  if (defaults.length > 0) {
    menu.setDefaultChannels(defaults.slice(0, 25));
  }
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(menu);
};

const addAdvancedStep = (container: ContainerBuilder, draft: PollDraft): void => {
  const passRuleAvailable = draft.mode === 'single' || draft.mode === 'multi';
  const otherAvailable = draft.mode === 'single' || draft.mode === 'multi';

  container.addSectionComponents(
    sectionWithEdit(
      `**Quorum**\n${draft.quorumPercent !== null ? `${draft.quorumPercent}% of eligible voters must participate` : 'Disabled'}`,
      'quorum',
      { style: ButtonStyle.Primary },
    ),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**Allowed roles** · ${renderRolesPreview(draft.allowedRoleIds, '*Everyone may vote*')}`),
  );
  container.addActionRowComponents(
    buildRoleSelectRow('allowed-roles', draft.allowedRoleIds, 'Roles allowed to vote (none = everyone)', true),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**Blocked roles** · ${renderRolesPreview(draft.blockedRoleIds)}`),
  );
  container.addActionRowComponents(
    buildRoleSelectRow('blocked-roles', draft.blockedRoleIds, 'Roles blocked from voting', true),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**Eligible channels** · ${renderChannelsPreview(draft.eligibleChannelIds)}`),
  );
  container.addActionRowComponents(buildChannelSelectRow(draft.eligibleChannelIds));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**Reminder role** · ${draft.reminderRoleId ? `<@&${draft.reminderRoleId}>` : '*No ping*'}`,
    ),
  );
  container.addActionRowComponents(
    buildRoleSelectRow('reminder-role', draft.reminderRoleId ? [draft.reminderRoleId] : [], 'Role to ping on reminders', false),
  );

  container.addSectionComponents(
    sectionWithEdit(
      `**Pass rule**\n${renderPassRulePreview(draft)}`,
      'pass-rule',
      { disabled: !passRuleAvailable },
    ),
  );

  container.addSectionComponents(
    sectionWithToggle(
      `**“Other” option:** ${otherAvailable ? (draft.allowOtherOption ? 'Voters can submit their own option' : 'Disabled') : `*Not used in ${getModeLabel(draft.mode).toLowerCase()} polls.*`}`,
      'allow-other',
      draft.allowOtherOption,
      !otherAvailable,
    ),
  );
};

const buildContainer = (draft: PollDraft, error?: string): ContainerBuilder => {
  const container = new ContainerBuilder().setAccentColor(error ? ACCENT_ERROR : ACCENT_COLOR);

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(buildStepHeader(draft)));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${STEP_HINTS[draft.step]}`));
  if (error) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Warning: ${error}`));
  }
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  switch (draft.step) {
    case 'mode':
      addModeStep(container, draft);
      break;
    case 'content':
      addContentStep(container, draft);
      break;
    case 'timing':
      addTimingStep(container, draft);
      break;
    case 'advanced':
      addAdvancedStep(container, draft);
      break;
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );
  container.addActionRowComponents(buildNavRow(draft));

  return container;
};

export const buildPollBuilderPreview = (
  draft: PollDraft,
  error?: string,
): {
  flags: number;
  components: ContainerBuilder[];
  allowedMentions: { parse: [] };
} => ({
  flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  components: [buildContainer(draft, error)],
  allowedMentions: { parse: [] },
});

export const buildPollBuilderFinalMessage = (
  title: string,
  body: string,
  variant: 'success' | 'cancel',
): {
  flags: number;
  components: ContainerBuilder[];
  allowedMentions: { parse: [] };
} => {
  const container = new ContainerBuilder()
    .setAccentColor(variant === 'success' ? ACCENT_COLOR : ACCENT_ERROR)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [container],
    allowedMentions: { parse: [] },
  };
};

const labelFor = (
  label: string,
  description: string | undefined,
  component:
    | TextInputBuilder
    | StringSelectMenuBuilder,
): LabelBuilder => {
  const builder = new LabelBuilder().setLabel(label);
  if (description) builder.setDescription(description);
  if (component instanceof TextInputBuilder) {
    builder.setTextInputComponent(component);
  } else {
    builder.setStringSelectMenuComponent(component);
  }
  return builder;
};

export const buildPollBuilderModal = (
  field: PollBuilderModalField,
  draft: PollDraft,
): ModalBuilder => {
  const modal = new ModalBuilder().setCustomId(pollBuilderModalCustomId(field));

  switch (field) {
    case 'question': {
      const input = new TextInputBuilder()
        .setCustomId('value')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(draft.question)
        .setMaxLength(200);
      return modal
        .setTitle('Edit question')
        .addLabelComponents(labelFor('Question', 'Shown at the top of the poll', input));
    }
    case 'choices': {
      const label = getContentEntryLabel(draft.mode);
      const unit = getContentEntryUnit(draft.mode);
      const input = new TextInputBuilder()
        .setCustomId('value')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setValue(draft.choices.join(', '))
        .setMaxLength(500);
      return modal
        .setTitle(`Edit ${label.toLowerCase()}`)
        .addLabelComponents(labelFor(label, `Comma-separated · 2-10 ${unit}s · max 80 chars each`, input));
    }
    case 'tier-labels': {
      const input = new TextInputBuilder()
        .setCustomId('value')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue((draft.tierLabels.length > 0 ? draft.tierLabels : [...DEFAULT_TIER_LABELS]).join(', '))
        .setPlaceholder('S, A, B, C, D, F')
        .setMaxLength(120);
      return modal
        .setTitle('Edit tier labels')
        .addLabelComponents(labelFor('Tier labels', 'Comma-separated, top tier first · 2-6 entries · leave blank for S/A/B/C/D/F', input));
    }
    case 'description': {
      const input = new TextInputBuilder()
        .setCustomId('value')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setValue(draft.description)
        .setMaxLength(1_000);
      return modal
        .setTitle('Edit description')
        .addLabelComponents(labelFor('Description', 'Optional context shown below the question', input));
    }
    case 'emojis': {
      const unit = getContentEntryUnit(draft.mode);
      const input = new TextInputBuilder()
        .setCustomId('value')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setValue(draft.choiceEmojis.map((emoji) => emoji ?? '').join(', '))
        .setPlaceholder('<:yes:123>, <:no:456> or blank')
        .setMaxLength(500);
      return modal
        .setTitle('Edit emojis')
        .addLabelComponents(labelFor('Emojis', `Comma-separated · one per ${unit} · leave blank to use numbered defaults`, input));
    }
    case 'time': {
      const durationInput = new TextInputBuilder()
        .setCustomId('duration')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(draft.durationText || '24h')
        .setPlaceholder('1d 12h 15m');
      const remindersInput = new TextInputBuilder()
        .setCustomId('reminders')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(draft.reminderOffsets.map((minutes) => formatDurationFromMinutes(minutes)).join(', '))
        .setPlaceholder('1d, 1h, 10m or none');
      return modal
        .setTitle('Edit timing')
        .addLabelComponents(
          labelFor('Duration', 'How long the poll stays open from publish', durationInput),
          labelFor('Reminders', 'Comma-separated offsets before close · "none" to disable', remindersInput),
        );
    }
    case 'quorum': {
      const input = new TextInputBuilder()
        .setCustomId('quorum')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(draft.quorumPercent !== null ? String(draft.quorumPercent) : '')
        .setPlaceholder('Leave blank to disable')
        .setMaxLength(3);
      return modal
        .setTitle('Edit quorum')
        .addLabelComponents(labelFor('Quorum %', 'Minimum share of eligible voters needed for the result to count', input));
    }
    case 'pass-rule': {
      const thresholdInput = new TextInputBuilder()
        .setCustomId('threshold')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(draft.passThreshold ? String(draft.passThreshold) : '')
        .setPlaceholder('Leave blank to disable')
        .setMaxLength(3);
      const choiceInput = new TextInputBuilder()
        .setCustomId('pass-choice')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(
          draft.passThreshold && draft.passOptionIndex !== null
            ? String(draft.passOptionIndex + 1)
            : '',
        )
        .setPlaceholder(`1-${Math.max(draft.choices.length, 1)} · defaults to 1`)
        .setMaxLength(2);
      return modal
        .setTitle('Edit pass rule')
        .addLabelComponents(
          labelFor('Threshold %', 'Percentage the measured choice must reach', thresholdInput),
          labelFor('Measured choice number', 'Which choice the threshold applies to', choiceInput),
        );
    }
    case 'thread-name': {
      const input = new TextInputBuilder()
        .setCustomId('value')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(draft.threadName)
        .setPlaceholder('Leave blank to use the poll question')
        .setMaxLength(100);
      return modal
        .setTitle('Edit thread name')
        .addLabelComponents(labelFor('Thread name', 'Discussion thread title', input));
    }
  }
};
