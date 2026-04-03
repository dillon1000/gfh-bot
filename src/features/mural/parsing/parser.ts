const hexColorPattern = /^#?([0-9a-fA-F]{6})$/;

export const muralCanvasSize = 100;

export const parseMuralCoordinate = (
  value: number,
  label: 'x' | 'y',
): number => {
  if (!Number.isInteger(value) || value < 0 || value >= muralCanvasSize) {
    throw new Error(`The ${label} coordinate must be an integer from 0 to ${muralCanvasSize - 1}.`);
  }

  return value;
};

export const parseMuralColor = (value: string): string => {
  const match = hexColorPattern.exec(value.trim());
  if (!match?.[1]) {
    throw new Error('Color must be a 6-digit hex value like #FF6600.');
  }

  return `#${match[1].toUpperCase()}`;
};
