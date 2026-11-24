import { Expose } from 'class-transformer';

export class FieldChangeDto {
  @Expose() from: string;
  @Expose() to: string;
}
