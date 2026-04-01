import { describe, expect, it } from 'vitest';

import { resolveSingleSelectVoteToggle } from '../src/features/polls/core/vote-toggle.js';

describe('resolveSingleSelectVoteToggle', () => {
  it('removes the vote when clicking the currently selected option again', () => {
    expect(resolveSingleSelectVoteToggle(['option_1'], 'option_1')).toEqual([]);
  });

  it('switches to the clicked option when a different option is chosen', () => {
    expect(resolveSingleSelectVoteToggle(['option_1'], 'option_2')).toEqual(['option_2']);
  });

  it('creates a vote when the user has not voted yet', () => {
    expect(resolveSingleSelectVoteToggle([], 'option_2')).toEqual(['option_2']);
  });
});
