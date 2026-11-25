import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { ConfigService } from '@src/tools/config';
import { DATABASE, MIGRATIONS_FOLDER } from './consts/database.const';

export type Database = NodePgDatabase;
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Opens the PostgreSQL connection pool, applies migrations, and closes the pool at shutdown. */
@Global()
@Module({
  providers: [
    {
      provide: Pool,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Pool({
          host: config.getEnv('DB_HOST'),
          port: config.getEnv('DB_PORT'),
          user: config.getEnv('DB_USER'),
          password: config.getEnv('DB_PASSWORD'),
          database: config.getEnv('DB_DATABASE'),
        }),
    },
    {
      provide: DATABASE,
      inject: [Pool],
      useFactory: async (pool: Pool): Promise<Database> => {
        const db = drizzle(pool);
        try {
          await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

          return db;
        } catch (error) {
          await pool.end();
          throw error;
        }
      },
    },
  ],
  exports: [DATABASE],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(Pool) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
