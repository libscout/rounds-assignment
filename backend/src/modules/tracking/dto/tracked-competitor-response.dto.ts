import { Expose } from 'class-transformer';

export class TrackedCompetitorResponseDto {
  @Expose()
  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }
}
