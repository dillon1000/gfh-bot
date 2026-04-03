import { describe, expect, it } from 'vitest';

import {
  muralCanvasSize,
  parseMuralColor,
  parseMuralCoordinate,
} from '../src/features/mural/parsing/parser.js';

describe('mural parser', () => {
  it('normalizes hex colors to uppercase with a leading hash', () => {
    expect(parseMuralColor('ff6600')).toBe('#FF6600');
    expect(parseMuralColor('#00aaee')).toBe('#00AAEE');
  });

  it('rejects malformed colors', () => {
    expect(() => parseMuralColor('#GG0000')).toThrow(/6-digit hex/);
    expect(() => parseMuralColor('#12345')).toThrow(/6-digit hex/);
  });

  it('accepts coordinates on the canvas bounds', () => {
    expect(parseMuralCoordinate(0, 'x')).toBe(0);
    expect(parseMuralCoordinate(muralCanvasSize - 1, 'y')).toBe(muralCanvasSize - 1);
  });

  it('rejects out-of-bounds coordinates', () => {
    expect(() => parseMuralCoordinate(-1, 'x')).toThrow(/0 to 99/);
    expect(() => parseMuralCoordinate(100, 'y')).toThrow(/0 to 99/);
  });
});
