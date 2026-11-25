import { Pool } from 'pg';
import { type ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { ConfigModule } from '@src/tools/config';
import { validateEnv } from '@src/tools/config/config.schema';
import { DbModule } from '@src/tools/db';
import { ContextModule } from '@src/tools/context';
import { LoggerModule } from '@src/tools/logger';

/** Starts an isolated Nest test module backed by a disposable PostgreSQL database. */
export class TestEnv {
  private constructor(
    readonly nest: TestingModule,
    private readonly postgres: StartedTestContainer,
  ) {}

  async cleanup(): Promise<void> {
    try {
      await this.nest.close();
    } finally {
      await this.postgres.stop();
    }
  }

  static async create(
    opts: Partial<ModuleMetadata> = {},
    beforeMigrate?: (pool: Pool) => Promise<void>,
  ): Promise<TestEnv> {
    const postgres = await new GenericContainer('postgres:18.4-alpine')
      .withEnvironment({
        POSTGRES_USER: 'test',
        POSTGRES_PASSWORD: 'test',
        POSTGRES_DB: 'test',
      })
      .withExposedPorts(5432)
      .withHealthCheck({
        test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U test -d test'],
        interval: 1000,
        timeout: 3000,
        retries: 30,
        startPeriod: 1000,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .start();

    try {
      const config = validateEnv({
        NODE_ENV: 'test',
        PORT: 3000,
        DB_USER: 'test',
        DB_PASSWORD: 'test',
        DB_DATABASE: 'test',
        DB_HOST: postgres.getHost(),
        DB_PORT: postgres.getMappedPort(5432),
      });
      if (beforeMigrate) {
        const pool = new Pool({
          host: config.DB_HOST,
          port: config.DB_PORT,
          user: config.DB_USER,
          password: config.DB_PASSWORD,
          database: config.DB_DATABASE,
        });
        try {
          await beforeMigrate(pool);
        } finally {
          await pool.end();
        }
      }
      const nest = await Test.createTestingModule({
        ...opts,
        imports: [
          ConfigModule.with_config(config),
          DbModule,
          ContextModule,
          LoggerModule.register({ service: 'test' }),
          ...(opts.imports ?? []),
        ],
      }).compile();
      await nest.init();

      return new TestEnv(nest, postgres);
    } catch (err) {
      await postgres.stop();
      throw err;
    }
  }
}
