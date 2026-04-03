import type { DilemmaChoice } from '@prisma/client';

export const dilemmaChoiceButtonCustomId = (
  roundId: string,
  choice: DilemmaChoice,
): string => `dilemma:choice:${roundId}:${choice}`;

export const parseDilemmaChoiceButtonCustomId = (
  customId: string,
): { roundId: string; choice: DilemmaChoice } | null => {
  const match = /^dilemma:choice:([^:]+):(cooperate|defect)$/.exec(customId);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    roundId: match[1],
    choice: match[2] as DilemmaChoice,
  };
};
