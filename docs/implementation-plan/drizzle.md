# Backend transition to Drizzle

Use PostgreSQL, the existing `pg` driver, Drizzle ORM for application queries, and Drizzle Kit for versioned SQL migrations. The backend now uses this stack. The bootstrap applies committed migrations before the app starts.

| Area in `backend/` | Planned change |
| --- | --- |
| Packages | Replace `typeorm` and `@nestjs/typeorm` with `drizzle-orm`. Keep `pg`, add `drizzle-kit` and `@types/pg` as development dependencies, and regenerate the npm lockfile. |
| Nest database wiring | In `src/tools/db/db.module.ts`, create a single `pg.Pool` from the existing `DB_*` settings and export an injectable typed Drizzle client. Remove `forFeature` and per-entity repository registration. Enable Nest shutdown hooks and close the pool after background work drains. |
| Table definitions and queries | Keep module-owned `pgTable` definitions under `src/modules/<domain>/entities/`, with a distinct filename such as `watchlist.table.ts`. Configure schema discovery to match table files. Use inferred row types internally, explicit DTOs at the HTTP boundary, and Drizzle transactions for claims, cooldown updates, and retry scheduling. |
| Kit and migrations | Replace `src/tools/db/data-source.ts` with `backend/drizzle.config.ts`. Generate and commit SQL and migration metadata, including SQL to seed the singleton cooldown row. Apply migrations once before workers start. Keep the CLI config outside the Nest production compilation by excluding it in `tsconfig.build.json` (its `rootDir` is `src`). Package migration artifacts and the selected runner in the deployment image. |
| Commands and docs | Update package scripts and `backend/README.md` together. Use `drizzle-kit generate` for schema changes and `drizzle-kit migrate` to apply them. Review the existing create, revert, and show scripts individually and document supported workflows. Update the ORM-specific testing language in `backend/rules.md`. |
| Tests and config | Remove `DB_SCHEMA_SYNC` from `src/tools/config/config.schema.ts` and `test/nest.ts`. Run the committed migrations against the mapped PostgreSQL Testcontainer before Nest starts. Convert repository-token fixtures and assertions to Drizzle queries. Controller DTO and HTTP contract tests still apply. |

## Assignment setup

The backend retired the Users and Posts demo modules and the Redis dependency. The tracking migration creates its tables on a new database and leaves existing demo tables intact. The database settings in `backend/.env.example` serve both the Nest application and Drizzle Kit. The PostgreSQL Testcontainer runs the same committed migrations during application initialization.

## Verification

Run the production build, apply migrations twice to a clean test database, and verify the second run preserves data and leaves exactly one cooldown row. Exercise duplicate watchlist adds, a failed transaction, and recovery after a lost snapshot acknowledgement with real PostgreSQL. [Drizzle PostgreSQL driver](https://orm.drizzle.team/docs/get-started-postgresql) · [Generating migrations](https://orm.drizzle.team/docs/drizzle-kit-generate) · [Applying migrations](https://orm.drizzle.team/docs/drizzle-kit-migrate)
