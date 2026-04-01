export const resolveSingleSelectVoteToggle = (
  currentOptionIds: string[],
  clickedOptionId: string,
): string[] =>
  currentOptionIds.length === 1 && currentOptionIds[0] === clickedOptionId
    ? []
    : [clickedOptionId];
