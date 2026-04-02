import type { Poll, PollReminder } from '@prisma/client';

import { pollCloseQueue, pollReminderQueue } from '../../../../lib/queue.js';
import { prisma } from '../../../../lib/prisma.js';

const minuteMs = 60_000;

export const buildPollReminderRecords = (
  closesAt: Date,
  reminderOffsets: number[],
): Array<{ offsetMinutes: number; remindAt: Date }> =>
  reminderOffsets.map((offsetMinutes) => ({
    offsetMinutes,
    remindAt: new Date(closesAt.getTime() - offsetMinutes * minuteMs),
  }));

const getQueueJobId = (id: string): string => Buffer.from(id).toString('base64url');

const getQueueJobIdsForLookup = (id: string): string[] => {
  const encodedId = getQueueJobId(id);
  return encodedId === id ? [id] : [encodedId, id];
};

export const removeScheduledPollClose = async (pollId: string): Promise<void> => {
  await Promise.all(getQueueJobIdsForLookup(pollId).map(async (jobId) => {
    const job = await pollCloseQueue.getJob(jobId);
    await job?.remove();
  }));
};

export const removeScheduledPollReminders = async (reminderIds: string[]): Promise<void> => {
  await Promise.all(reminderIds.flatMap((reminderId) => getQueueJobIdsForLookup(reminderId)).map(async (jobId) => {
    const job = await pollReminderQueue.getJob(jobId);
    await job?.remove();
  }));
};

export const replaceScheduledPollJobs = async (
  poll: Pick<Poll, 'id' | 'closesAt'> & {
    reminders: Array<Pick<PollReminder, 'id' | 'remindAt' | 'sentAt'>>;
  },
  previousReminderIds: string[] = [],
): Promise<void> => {
  await Promise.all([
    removeScheduledPollClose(poll.id),
    removeScheduledPollReminders(previousReminderIds),
  ]);

  await Promise.all([
    schedulePollClose(poll),
    schedulePollReminders(poll.reminders),
  ]);
};

export const schedulePollClose = async (poll: Pick<Poll, 'id' | 'closesAt'>): Promise<void> => {
  const delay = Math.max(0, poll.closesAt.getTime() - Date.now());

  await pollCloseQueue.add(
    'close',
    { pollId: poll.id },
    {
      jobId: getQueueJobId(poll.id),
      delay,
    },
  );
};

export const schedulePollReminder = async (
  reminder: Pick<PollReminder, 'id' | 'remindAt' | 'sentAt'>,
): Promise<void> => {
  if (reminder.sentAt) {
    return;
  }

  const delay = reminder.remindAt.getTime() - Date.now();

  if (delay <= 0) {
    return;
  }

  await pollReminderQueue.add(
    'remind',
    { reminderId: reminder.id },
    {
      jobId: getQueueJobId(reminder.id),
      delay,
    },
  );
};

export const schedulePollReminders = async (
  reminders: Array<Pick<PollReminder, 'id' | 'remindAt' | 'sentAt'>>,
): Promise<void> => {
  await Promise.all(reminders.map((reminder) => schedulePollReminder(reminder)));
};

export const syncOpenPollCloseJobs = async (): Promise<void> => {
  const polls = await prisma.poll.findMany({
    where: {
      closedAt: null,
      closesAt: {
        gt: new Date(),
      },
    },
    select: {
      id: true,
      closesAt: true,
    },
  });

  await Promise.all(polls.map((poll) => schedulePollClose(poll)));
};

export const syncOpenPollReminderJobs = async (): Promise<void> => {
  const reminders = await prisma.pollReminder.findMany({
    where: {
      sentAt: null,
      remindAt: {
        gt: new Date(),
      },
      poll: {
        closedAt: null,
      },
    },
    select: {
      id: true,
      remindAt: true,
      sentAt: true,
    },
  });

  await schedulePollReminders(reminders);
};
