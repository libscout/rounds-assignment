import { pollLogs } from '../entities/poll-logs.table';

const { pollId, competitorId, finishedAt, status, listingFields, failedAttempts } =
  pollLogs;
export const observationColumns = {
  pollId,
  competitorId,
  finishedAt,
  status,
  listingFields,
  failedAttempts,
};
