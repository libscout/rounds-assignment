import { ListingChangeRepository } from '@src/modules/change-history/repositories/listing-change.repository';
import { readFile, writeFile, mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS_FOLDER } from '@src/tools/db/migrations.const';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { TestEnv } from '@test/nest';
import { DATABASE, type Database } from '@src/tools/db';
import { ChangeHistoryService } from '@src/modules/change-history/services';
import { pollAttempts } from '../entities';
import { ListingHistoryRepository } from '../repositories';
import { PollBaselineReader } from './poll-baseline.reader';
import { LegacyChangeImport } from './legacy-change-import';

describe('upgrade from snapshot storage', () => {
  const baseline = randomUUID(),
    changed = randomUUID(),
    pending = randomUUID();
  let env: TestEnv;
  beforeAll(async () => {
    env = await TestEnv.create(
      {
        providers: [
          ListingHistoryRepository,
          PollBaselineReader,
          ListingChangeRepository,
          ChangeHistoryService,
          LegacyChangeImport,
        ],
      },
      async (pool) => {
        const old = await mkdtemp(join(tmpdir(), 'rounds-migrations-'));
        try {
          const journal = JSON.parse(
            await readFile(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8'),
          ) as { entries: { idx: number; tag: string }[] };
          journal.entries = journal.entries.filter((entry) => entry.idx <= 2);
          await mkdir(join(old, 'meta'));
          await writeFile(join(old, 'meta/_journal.json'), JSON.stringify(journal));
          for (const { tag } of journal.entries)
            await copyFile(join(MIGRATIONS_FOLDER, tag + '.sql'), join(old, tag + '.sql'));
          await migrate(drizzle(pool), { migrationsFolder: old });
        } finally {
          await rm(old, { force: true, recursive: true });
        }
        await pool.query("insert into watchlist(id,active) values ('demo',false),('other',false)");
        const fields = { title: 'CRM', tagline: 'Teams', description: 'A & B', price: '$39/mo' };
        await pool.query('insert into listing_versions(id,fields) values ($1,$2),($3,$4)', [
          baseline,
          fields,
          changed,
          { ...fields, description: 'A &amp; B', price: '$29/mo' },
        ]);
        await pool.query(
          `insert into listing_snapshots(poll_id,competitor_id,fetched_at,outcome_kind,version_id,changed,http_status) values
       ($1,'demo','2026-01-01','complete',$1,false,200),($2,'demo','2026-01-02','complete',$2,true,200)`,
          [baseline, changed],
        );
        await pool.query(
          `insert into pending_polls(id,competitor_id,attempt_no,status,outcome_kind,finished_at,next_delivery_at) values
       ($1,'demo',2,'success','complete',now(),now()),($2,'other',1,'pending',null,null,null)`,
          [changed, pending],
        );
      },
    );
  }, 180000);
  afterAll(async () => {
    await env?.cleanup();
  });
  it('merges duplicate deliveries, preserves outstanding work and reconstructs historical diffs only once', async () => {
    const db = env.nest.get<Database>(DATABASE);
    const rows = await db.select().from(pollAttempts);
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.id === baseline)).toMatchObject({
      attemptNo: null,
      createdAt: null,
      versionId: baseline,
    });
    expect(rows.find((row) => row.id === changed)).toMatchObject({
      attemptNo: 2,
      versionId: changed,
      nextDeliveryAt: null,
    });
    expect(rows.find((row) => row.id === pending)).toMatchObject({
      status: 'pending',
      processedAt: null,
    });
    await env.nest.get(LegacyChangeImport).onModuleInit();
    const changes = await env.nest
      .get(ChangeHistoryService)
      .byPollIds([baseline, changed, pending]);
    expect(changes).toHaveLength(1);
    expect(changes[0].changedFields).toEqual({ price: { from: '$39/mo', to: '$29/mo' } });
  });
});
