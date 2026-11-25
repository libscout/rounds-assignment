import { Expose } from 'class-transformer';

export class RequestedPollDto {
  @Expose()
  readonly pollId: string;

  @Expose()
  readonly created: boolean;

  constructor(result: { pollId: string; created: boolean }) {
    this.pollId = result.pollId;
    this.created = result.created;
  }
}
