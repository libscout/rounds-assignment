import { Expose } from 'class-transformer';

export class TrackedCompetitorListItemDto {
  @Expose()
  readonly id: string;

  @Expose()
  readonly changedInLast24h: boolean | null;

  constructor(id: string, changedInLast24h: boolean | null) {
    this.id = id;
    this.changedInLast24h = changedInLast24h;
  }
}
