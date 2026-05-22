export type PollBuilderAction =
  | 'question'
  | 'choices'
  | 'tier-labels'
  | 'emojis'
  | 'description'
  | 'time'
  | 'quorum'
  | 'pass-rule'
  | 'thread-toggle'
  | 'thread-name'
  | 'allow-other'
  | 'anonymous'
  | 'hide-results'
  | 'step-next'
  | 'step-back'
  | 'publish'
  | 'cancel';

export type PollBuilderModalField =
  | 'question'
  | 'choices'
  | 'tier-labels'
  | 'emojis'
  | 'description'
  | 'time'
  | 'quorum'
  | 'pass-rule'
  | 'thread-name';

export type PollBuilderSelect =
  | 'mode'
  | 'allowed-roles'
  | 'blocked-roles'
  | 'eligible-channels'
  | 'reminder-role';

export type PollManageAction = 'edit' | 'cancel' | 'reopen' | 'extend';

export const pollVoteCustomId = (pollId: string): string => `poll:vote:${pollId}`;
export const pollChoiceCustomId = (pollId: string, optionId: string): string => `poll:choice:${pollId}:${optionId}`;
export const pollResponseButtonCustomId = (pollId: string, kind: 'freeform' | 'other'): string => `poll:response:${kind}:${pollId}`;
export const pollResponseModalCustomId = (pollId: string, kind: 'freeform' | 'other'): string => `poll:response-modal:${kind}:${pollId}`;
export const pollResultsCustomId = (pollId: string): string => `poll:results:${pollId}`;
export const pollRankOpenCustomId = (pollId: string): string => `poll:rank:open:${pollId}`;
export const pollRankAddCustomId = (pollId: string, optionId: string): string => `poll:rank:add:${pollId}:${optionId}`;
export const pollRankUndoCustomId = (pollId: string): string => `poll:rank:undo:${pollId}`;
export const pollRankClearCustomId = (pollId: string): string => `poll:rank:clear:${pollId}`;
export const pollRankSubmitCustomId = (pollId: string): string => `poll:rank:submit:${pollId}`;
export const pollCloseModalCustomId = (pollId: string): string => `poll:close-modal:${pollId}`;
export const pollManageModalCustomId = (action: PollManageAction, pollId: string): string => `poll:manage-modal:${action}:${pollId}`;
export const pollBuilderButtonCustomId = (action: PollBuilderAction): string => `poll-builder:${action}`;
export const pollBuilderModalCustomId = (field: PollBuilderModalField): string => `poll-builder:modal:${field}`;
export const pollBuilderSelectCustomId = (select: PollBuilderSelect): string => `poll-builder:select:${select}`;
export const pollTierOpenCustomId = (pollId: string): string => `poll:tier:open:${pollId}`;
export const pollTierItemSelectCustomId = (pollId: string): string => `poll:tier:item-select:${pollId}`;
export const pollTierSelectCustomId = (pollId: string, optionId: string): string => `poll:tier:select:${pollId}:${optionId}`;
export const pollTierClearCustomId = (pollId: string): string => `poll:tier:clear:${pollId}`;
export const pollTierImageItemSelectCustomId = (pollId: string): string => `poll:tier:image:item-select:${pollId}`;
export const pollTierImageUploadCustomId = (pollId: string, optionId: string): string => `poll:tier:image:upload:${pollId}:${optionId}`;
export const pollTierImageRemoveCustomId = (pollId: string, optionId: string): string => `poll:tier:image:remove:${pollId}:${optionId}`;
export const pollTierImageModalCustomId = (pollId: string, optionId: string): string => `poll:tier:image-modal:${pollId}:${optionId}`;
export const pollRationaleUpvoteCustomId = (rationaleId: string): string => `poll:rationale-upvote:${rationaleId}`;
export const pollRationaleOpenCustomId = (pollId: string): string => `poll:rationale-open:${pollId}`;
export const pollRationaleModalCustomId = (pollId: string): string => `poll:rationale-modal:${pollId}`;
