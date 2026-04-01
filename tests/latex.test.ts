import { describe, expect, it } from 'vitest';

import { renderLatexToPng } from '../src/features/meta/commands/latex.js';

describe('latex renderer', () => {
  it('renders a valid expression into a png buffer', async () => {
    const output = await renderLatexToPng('\\int_0^1 x^2 \\, dx', true);

    expect(output.byteLength).toBeGreaterThan(1000);
    expect(output.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it('rejects empty expressions', async () => {
    await expect(renderLatexToPng('   ', true)).rejects.toThrow(/Provide some LaTeX/);
  });
});
