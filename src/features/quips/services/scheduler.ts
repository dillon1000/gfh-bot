import type { QuipsRound } from '@prisma/client';

import { quipsAnswerCloseQueue, quipsAnswerCloseQueueName, quipsVoteCloseQueue, quipsVoteCloseQueueName } from '../../../lib/queue.js';
import { prisma } from '../../../lib/prisma.js';
import { getQuipsQueueJobId } from '../core/shared.js';

const getAnswerJobId = (roundId: string): string => getQuipsQueueJobId(`quips-answer:${roundId}`);
const getVoteJobId = (roundId: string): string => getQuipsQueueJobId(`quips-vote:${roundId}`);

export const removeScheduledQuipsAnswerClose = async (roundId: string): Promise<void> => {
  const job = await quipsAnswerCloseQueue.getJob(getAnswerJobId(roundId));
  await job?.remove();
};

export const removeScheduledQuipsVoteClose = async (roundId: string): Promise<void> => {
  const job = await quipsVoteCloseQueue.getJob(getVoteJobId(roundId));
  await job?.remove();
};

export const scheduleQuipsAnswerClose = async (
  round: Pick<QuipsRound, 'id' | 'answerClosesAt'>,
): Promise<void> => {
  await removeScheduledQuipsAnswerClose(round.id);
  await quipsAnswerCloseQueue.add(
    'close',
    { roundId: round.id },
    {
      jobId: getAnswerJobId(round.id),
      delay: Math.max(0, round.answerClosesAt.getTime() - Date.now()),
    },
  );
};

export const scheduleQuipsVoteClose = async (
  round: Pick<QuipsRound, 'id' | 'voteClosesAt'>,
): Promise<void> => {
  if (!round.voteClosesAt) {
    return;
  }

  await removeScheduledQuipsVoteClose(round.id);
  await quipsVoteCloseQueue.add(
    'close',
    { roundId: round.id },
    {
      jobId: getVoteJobId(round.id),
      delay: Math.max(0, round.voteClosesAt.getTime() - Date.now()),
    },
  );
};

export const syncOpenQuipsJobs = async (): Promise<void> => {
  const answeringRounds = await prisma.quipsRound.findMany({
    where: {
      phase: 'answering',
      answerClosesAt: {
        gt: new Date(),
      },
    },
    select: {
      id: true,
      answerClosesAt: true,
    },
  });

  const votingRounds = await prisma.quipsRound.findMany({
    where: {
      phase: 'voting',
      voteClosesAt: {
        not: null,
        gt: new Date(),
      },
    },
    select: {
      id: true,
      voteClosesAt: true,
    },
  });

  await Promise.all([
    ...answeringRounds.map((round) => scheduleQuipsAnswerClose(round)),
    ...votingRounds.map((round) => scheduleQuipsVoteClose(round)),
  ]);
};
