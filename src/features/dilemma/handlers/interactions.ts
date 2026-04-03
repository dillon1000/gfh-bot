import type { ButtonInteraction, Client } from 'discord.js';

import {
  finalizeCompletedDilemmaRound,
  submitDilemmaChoice,
} from '../services/lifecycle.js';
import { parseDilemmaChoiceButtonCustomId } from '../ui/custom-ids.js';

export const handleDilemmaButton = async (
  client: Client,
  interaction: ButtonInteraction,
): Promise<void> => {
  const parsed = parseDilemmaChoiceButtonCustomId(interaction.customId);
  if (!parsed) {
    return;
  }

  const outcome = await submitDilemmaChoice(client, {
    roundId: parsed.roundId,
    userId: interaction.user.id,
    choice: parsed.choice,
  });

  try {
    await interaction.update(outcome.currentPrompt);
  } finally {
    if (outcome.completedRoundId) {
      await finalizeCompletedDilemmaRound(client, outcome.completedRoundId);
    }
  }
};
