import { describe, expect, it } from 'vitest';

import { optionalEnum, optionalNonEmptyString, optionalUrlString } from '../src/app/env-utils.js';

describe('env-utils', () => {
  it('treats blank optional strings as undefined', () => {
    const schema = optionalNonEmptyString();

    expect(schema.parse('')).toBeUndefined();
    expect(schema.parse('   ')).toBeUndefined();
    expect(schema.parse(' value ')).toBe('value');
  });

  it('treats blank optional URLs as undefined', () => {
    const schema = optionalUrlString();

    expect(schema.parse('')).toBeUndefined();
    expect(schema.parse('https://example.com/base')).toBe('https://example.com/base');
  });

  it('treats blank optional enums as undefined', () => {
    const schema = optionalEnum(['online', 'idle']);

    expect(schema.parse('')).toBeUndefined();
    expect(schema.parse('idle')).toBe('idle');
  });
});
