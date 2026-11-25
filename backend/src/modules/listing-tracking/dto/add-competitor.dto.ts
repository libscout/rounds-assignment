import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, NotContains } from 'class-validator';

export class AddCompetitorDto {
  @Transform(({ value }: { value: unknown }) => {
    return typeof value === 'string' ? value.trim() : value;
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[^\uD800-\uDFFF]*$/u, { message: 'id must be valid Unicode' })
  @NotContains('\0')
  id: string;
}
