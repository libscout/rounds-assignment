import { Expose } from 'class-transformer';

export class ComparisonErrorDto {
  @Expose()
  pollId: string;

  @Expose()
  trackingFinishedAt: string;

  @Expose()
  status: 'error';
}
