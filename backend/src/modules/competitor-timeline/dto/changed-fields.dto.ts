import { Expose, Type } from 'class-transformer';
import { FieldChangeDto } from './field-change.dto';

export class ChangedFieldsDto {
  @Expose() @Type(() => FieldChangeDto) title?: FieldChangeDto;
  @Expose() @Type(() => FieldChangeDto) tagline?: FieldChangeDto;
  @Expose() @Type(() => FieldChangeDto) description?: FieldChangeDto;
  @Expose() @Type(() => FieldChangeDto) price?: FieldChangeDto;
}
