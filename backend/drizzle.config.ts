import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE } = process.env;

function connectionUrl(): string {
  const url = new URL('postgresql://localhost');
  url.hostname = DB_HOST;
  url.port = DB_PORT ?? '5432';
  url.username = DB_USER;
  url.password = DB_PASSWORD;
  url.pathname = '/' + encodeURIComponent(DB_DATABASE);
  return url.toString();
}

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/modules/*/entities/*.table.ts', './src/modules/*/types/*.enum.ts'],
  out: './src/tools/db/migrations',
  ...(DB_HOST &&
    DB_USER &&
    DB_PASSWORD &&
    DB_DATABASE && {
      dbCredentials: { url: connectionUrl() },
    }),
});
