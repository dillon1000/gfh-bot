import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import type { ArchetypeBreakdown } from '@/features/polls/services/archetypes.js';
import type { BellwetherEntry } from '@/features/polls/services/bellwethers.js';
import type {
  CounterfactualResult,
} from '@/features/polls/services/counterfactual.js';
import type {
  Faction,
  PolarizationEntry,
} from '@/features/polls/services/polarization.js';
import type { RationaleCluster } from '@/features/polls/services/rationales.js';
import { pollRationaleUpvoteCustomId } from '@/features/polls/ui/custom-ids.js';

const ARCHETYPE_BLURB: Record<string, { title: string; description: string }> = {
  trendsetter: {
    title: 'Trendsetter',
    description: 'Votes early. Others tend to follow your direction.',
  },
  bellwether: {
    title: 'Bellwether',
    description: "Your early votes correlate with the eventual winner. You read the room.",
  },
  contrarian: {
    title: 'Contrarian',
    description: 'You frequently side with the minority position.',
  },
  swing: {
    title: 'Swing Voter',
    description: 'You often change your mind during a poll. Open-minded or undecided.',
  },
  loyalist: {
    title: 'Loyalist',
    description: 'You usually agree with the eventual winner, but not particularly early.',
  },
  abstainer: {
    title: 'Abstainer',
    description: 'You rarely vote. Show up sometime.',
  },
  newcomer: {
    title: 'Newcomer',
    description: 'Not enough votes yet to classify.',
  },
};

export const buildArchetypeEmbed = (
  userId: string,
  breakdown: ArchetypeBreakdown | null,
): EmbedBuilder => {
  const embed = new EmbedBuilder().setTitle('Voter Archetype');
  if (!breakdown) {
    return embed
      .setDescription(`<@${userId}> has no poll voting history yet.`)
      .setColor(0x999999);
  }
  const blurb = ARCHETYPE_BLURB[breakdown.archetype] ?? ARCHETYPE_BLURB.newcomer;
  return embed
    .setDescription(`<@${userId}> — **${blurb?.title ?? breakdown.archetype}**\n${blurb?.description ?? ''}`)
    .addFields(
      { name: 'Polls voted', value: String(breakdown.pollsVoted), inline: true },
      { name: 'Vote changes', value: String(breakdown.voteChanges), inline: true },
      {
        name: 'With winner',
        value: `${Math.round(breakdown.winnerAgreementRate * 100)}%`,
        inline: true,
      },
      {
        name: 'With minority',
        value: `${Math.round(breakdown.minorityRate * 100)}%`,
        inline: true,
      },
      {
        name: 'Avg vote time',
        value: `${Math.round(breakdown.avgVoteFractionTime * 100)}% into poll`,
        inline: true,
      },
    )
    .setColor(0x4f46e5);
};

export const buildBellwetherEmbed = (entries: BellwetherEntry[]): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setTitle('Server Bellwethers')
    .setDescription('Members whose early votes most correlate with the final winner.')
    .setColor(0x10b981);
  if (entries.length === 0) {
    return embed.setDescription('Not enough closed polls to compute bellwethers yet.');
  }
  const lines = entries.slice(0, 15).map((entry, index) =>
    `**${index + 1}.** <@${entry.userId}> — score \`${entry.influenceScore}\` (${entry.agreedWithFinalWinnerEarly}/${entry.pollsParticipated} early-correct)`,
  );
  return embed.setDescription(lines.join('\n'));
};

export const buildPolarizationEmbed = (entries: PolarizationEntry[]): EmbedBuilder => {
  const embed = new EmbedBuilder().setTitle('Polarization Index').setColor(0xf97316);
  if (entries.length === 0) {
    return embed.setDescription('No closed polls to measure yet.');
  }
  const guildEntry = entries.find((entry) => entry.scopeKind === 'guild');
  const channelEntries = entries.filter((entry) => entry.scopeKind === 'channel').slice(0, 10);
  const sections: string[] = [];
  if (guildEntry) {
    sections.push(
      `**Server-wide:** index \`${guildEntry.polarizationIndex}\` across ${guildEntry.pollCount} polls, consensus rate ${Math.round(guildEntry.consensusRate * 100)}%`,
    );
  }
  if (channelEntries.length > 0) {
    sections.push('**By channel:**');
    for (const entry of channelEntries) {
      sections.push(`<#${entry.scope}> — \`${entry.polarizationIndex}\` (${entry.pollCount} polls)`);
    }
  }
  return embed.setDescription(sections.join('\n'));
};

export const buildFactionsEmbed = (factions: Faction[]): EmbedBuilder => {
  const embed = new EmbedBuilder().setTitle('Voting Factions').setColor(0xdb2777);
  if (factions.length === 0) {
    return embed.setDescription('No strong voting clusters detected yet.');
  }
  const lines: string[] = [];
  for (const faction of factions.slice(0, 8)) {
    const sample = faction.members.slice(0, 8).map((id) => `<@${id}>`).join(', ');
    const extra = faction.members.length > 8 ? ` +${faction.members.length - 8} more` : '';
    lines.push(`**Faction ${faction.id}** · affinity \`${faction.internalAffinity}\` · ${faction.members.length} members\n${sample}${extra}`);
  }
  return embed.setDescription(lines.join('\n\n'));
};

export const buildCounterfactualEmbed = (
  result: CounterfactualResult,
): EmbedBuilder => {
  const labelById = new Map<string, string>();
  for (const total of result.actualTotals) labelById.set(total.optionId, total.label);
  const fmt = (totals: CounterfactualResult['actualTotals']) =>
    totals.length === 0
      ? '_(no votes)_'
      : totals.map((entry) => `• ${entry.label}: ${entry.votes}`).join('\n');
  const winnerLabel = (id: string | null): string =>
    id ? labelById.get(id) ?? id : '(none)';
  return new EmbedBuilder()
    .setTitle(result.flipped ? 'Counterfactual: result would FLIP' : 'Counterfactual: result holds')
    .setColor(result.flipped ? 0xef4444 : 0x10b981)
    .setDescription(
      [
        `Excluded **${result.excludedUserCount}** voters.`,
        `Actual winner: **${winnerLabel(result.actualWinningOptionId)}**`,
        `Counterfactual winner: **${winnerLabel(result.counterfactualWinningOptionId)}**`,
      ].join('\n'),
    )
    .addFields(
      { name: 'Actual totals', value: fmt(result.actualTotals), inline: true },
      { name: 'Counterfactual totals', value: fmt(result.counterfactualTotals), inline: true },
    );
};

export const buildRationaleEmbed = (
  clusters: RationaleCluster[],
): { embed: EmbedBuilder; rows: ActionRowBuilder<ButtonBuilder>[] } => {
  const embed = new EmbedBuilder().setTitle('Anonymous Rationales').setColor(0x8b5cf6);
  if (clusters.length === 0 || clusters.every((cluster) => cluster.count === 0)) {
    return {
      embed: embed.setDescription('No rationales submitted yet. Use `/poll-rationale` to add one.'),
      rows: [],
    };
  }
  const lines: string[] = [];
  const topRationales: Array<{ id: string; text: string }> = [];
  for (const cluster of clusters) {
    lines.push(`**${cluster.themeLabel}** _(${cluster.count})_`);
    for (const rationale of cluster.rationales.slice(0, 3)) {
      const upvotePart = rationale.upvotes > 0 ? ` · ⬆${rationale.upvotes}` : '';
      lines.push(`> ${rationale.text}${upvotePart}`);
      if (topRationales.length < 5) topRationales.push({ id: rationale.id, text: rationale.text });
    }
    lines.push('');
  }
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  if (topRationales.length > 0) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const rationale of topRationales) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(pollRationaleUpvoteCustomId(rationale.id))
          .setLabel(`Upvote: ${rationale.text.slice(0, 40)}`)
          .setStyle(ButtonStyle.Secondary),
      );
    }
    rows.push(row);
  }
  return {
    embed: embed.setDescription(lines.join('\n').slice(0, 4000)),
    rows,
  };
};
