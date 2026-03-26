export type PollBuilderAction =
  | 'question'
  | 'choices'
  | 'emojis'
  | 'description'
  | 'time'
  | 'governance'
  | 'pass-rule'
  | 'thread-toggle'
  | 'thread-name'
  | 'mode'
  | 'anonymous'
  | 'publish'
  | 'cancel';

export type PollBuilderModalField =
  | 'question'
  | 'choices'
  | 'emojis'
  | 'description'
  | 'time'
  | 'governance'
  | 'pass-rule'
  | 'thread-name';

export const pollVoteCustomId = (pollId: string): string => `poll:vote:${pollId}`;
export const pollChoiceCustomId = (pollId: string, optionId: string): string => `poll:choice:${pollId}:${optionId}`;
export const pollResultsCustomId = (pollId: string): string => `poll:results:${pollId}`;
export const pollRankOpenCustomId = (pollId: string): string => `poll:rank:open:${pollId}`;
export const pollRankAddCustomId = (pollId: string, optionId: string): string => `poll:rank:add:${pollId}:${optionId}`;
export const pollRankUndoCustomId = (pollId: string): string => `poll:rank:undo:${pollId}`;
export const pollRankClearCustomId = (pollId: string): string => `poll:rank:clear:${pollId}`;
export const pollRankSubmitCustomId = (pollId: string): string => `poll:rank:submit:${pollId}`;
export const pollCloseModalCustomId = (pollId: string): string => `poll:close-modal:${pollId}`;
export const pollBuilderButtonCustomId = (action: PollBuilderAction): string => `poll-builder:${action}`;
export const pollBuilderModalCustomId = (field: PollBuilderModalField): string => `poll-builder:modal:${field}`;
