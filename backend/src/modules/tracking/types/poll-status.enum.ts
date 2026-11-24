import { pgEnum } from 'drizzle-orm/pg-core';

export enum PollStatus {
  Pending = 'pending',
  Success = 'success',
  Error = 'error',
}

export const pollStatus = pgEnum('poll_status', PollStatus);
