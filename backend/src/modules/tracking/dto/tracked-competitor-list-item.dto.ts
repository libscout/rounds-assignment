import { Expose } from 'class-transformer';
import { TrackedCompetitorResponseDto } from './tracked-competitor-response.dto';

export class TrackedCompetitorListItemDto extends TrackedCompetitorResponseDto {
  @Expose()
  readonly changedInLast24h: boolean;

  constructor(id: string, changed: boolean) {
    super(id);
    this.changedInLast24h = changed;
  }
}
