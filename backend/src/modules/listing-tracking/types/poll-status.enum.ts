export enum PollStatus {
  Queued = 'queued',
  Fetching = 'fetching',
  WaitingRetry = 'waiting_retry',
  Complete = 'complete',
  Missing = 'missing',
  Failed = 'failed',
}
