export interface PollAttempt {
  id: string;
  competitorId: string;
  attemptNo: number;
}

export interface ClaimedPoll extends PollAttempt {
  dueAt: Date;
}
