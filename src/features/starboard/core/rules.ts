export const isStarboardPromotionEligible = (reactionCount: number, threshold: number): boolean =>
  reactionCount >= threshold;
