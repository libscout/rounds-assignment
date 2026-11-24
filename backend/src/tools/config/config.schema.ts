import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsUrl,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/** Defines validation rules and defaults for the environment settings used at startup. */
export class EnvSchema {
  @IsNumber()
  @Min(1)
  @Max(65535)
  PORT: number;

  @IsEnum(['development', 'production', 'test'])
  NODE_ENV: 'development' | 'production' | 'test';

  @IsOptional()
  @IsString()
  IS_LOCAL_ENV?: string;

  @IsString()
  DB_HOST: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  DB_PORT: number;

  @IsString()
  DB_USER: string;

  @IsString()
  DB_PASSWORD: string;

  @IsString()
  DB_DATABASE: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  LISTING_SOURCE_URL = 'http://localhost:4002';

  @IsInt()
  @Min(1)
  POLL_INTERVAL_MS: number = 900_000;

  @IsInt()
  @Min(1)
  POLL_TIMEOUT_MS: number = 10_000;

  @IsInt()
  @Min(1)
  POLL_CONCURRENCY: number = 8;
}

export function validateEnv(raw: Record<string, unknown>): EnvSchema {
  const validated = plainToInstance(EnvSchema, raw, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: true,
  });

  if (errors.length > 0) {
    const formatted = errors
      .map((err) => {
        const constraints = Object.values(err.constraints ?? {}).join(', ');
        return `  ${err.property}: ${constraints}`;
      })
      .join('\n');
    throw new Error(`Config validation failed:\n${formatted}`);
  }

  return validated;
}
