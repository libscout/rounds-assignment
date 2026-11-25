import { Injectable } from '@nestjs/common';
import type { EnvSchema } from './config.schema';

/** Provides typed access to validated application settings. */
@Injectable()
export class ConfigService {
  /** Stores the validated environment settings for typed access. */
  constructor(private readonly env: EnvSchema) {}

  /** Reads the configured value for the requested environment key. */
  getEnv<K extends keyof EnvSchema>(key: K): EnvSchema[K] {
    return this.env[key];
  }

  /** Reads a required setting and throws if its value is absent. */
  expectEnv<K extends keyof EnvSchema>(key: K): EnvSchema[K] {
    const out = this.env[key];

    if (out === undefined || out === null) {
      throw new Error(`Environment variable "${key}" is undefined`);
    }

    return out;
  }
}
