import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { DATABASE, MIGRATIONS_FOLDER } from './consts/database.const';
import {
  pollLogs,
  sourceState,
  watchlist,
} from '@src/modules/listing-tracking/entities';
import { PollStatus } from '@src/modules/listing-tracking/types';
import { TestEnv } from '@test/nest';
import type { Database } from './db.module';

describe('tracking database', () => {
  let env: TestEnv;
  let db: Database;

  beforeAll(async () => {
    env = await TestEnv.create();
    db = env.nest.get<Database>(DATABASE);
  }, 180_000);

  afterEach(async () => {
    await db.delete(pollLogs);
    await db.delete(watchlist);
    await db
      .update(sourceState)
      .set({ cooldownUntil: null })
      .where(eq(sourceState.id, 1));
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it('preserves the shared cooldown across repeated migration runs', async () => {
    expect(await db.select().from(sourceState)).toEqual([
      { id: 1, cooldownUntil: null },
    ]);
    const deadline = new Date('2030-01-01T12:00:00Z');
    await db
      .update(sourceState)
      .set({ cooldownUntil: deadline })
      .where(eq(sourceState.id, 1));
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(await db.select().from(sourceState)).toEqual([
      { id: 1, cooldownUntil: deadline },
    ]);
  });

  it('enforces one outstanding attempt per listing and validates terminal outcomes', async () => {
    await db.insert(watchlist).values({ id: 'acme', nextDueAt: new Date() });
    const attempt = { competitorId: 'acme' };
    const [row] = await db.insert(pollLogs).values(attempt).returning();
    await expect(db.insert(pollLogs).values(attempt)).rejects.toMatchObject({
      cause: { code: '23505' },
    });
    await expect(
      db
        .update(pollLogs)
        .set({ status: PollStatus.Complete })
        .where(eq(pollLogs.pollId, row.pollId)),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    const finishedAt = new Date();
    await expect(
      db
        .update(pollLogs)
        .set({ status: PollStatus.Complete, finishedAt })
        .where(eq(pollLogs.pollId, row.pollId)),
    ).rejects.toMatchObject({ cause: { constraint: 'poll_logs_lifecycle' } });
    await db
      .update(pollLogs)
      .set({
        status: PollStatus.Missing,
        finishedAt,
      })
      .where(eq(pollLogs.pollId, row.pollId));
    expect(await db.select().from(pollLogs)).toMatchObject([
      { status: PollStatus.Missing },
    ]);
  });

  it('rejects an unknown poll status on an otherwise valid terminal row', async () => {
    await db.insert(watchlist).values({ id: 'acme' });
    await expect(
      db.insert(pollLogs).values({
        competitorId: 'acme',
        status: sql`'unknown'`,
        finishedAt: new Date(),
      }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'poll_logs_status' },
    });
  });

  it('rejects an unknown summary status on an otherwise valid terminal row', async () => {
    await expect(
      db.execute(sql`
      insert into ai_summaries (poll_id, diff, status, available_at, completed_at)
      values (uuidv7(), '{"kind":"disappeared","changedFields":{}}', 'unknown', null, now())
    `),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'ai_summary_status' },
    });
  });

  it.each([
    ['tracking_status', 'unknown', 'execution_tracking_done'],
    ['change_history_status', 'unknown', 'execution_history_required'],
    ['change_history_status', 'not_required', 'execution_history_required'],
    ['ai_summary_status', 'unknown', 'execution_ai_summary_status'],
  ])('rejects %s = %s in the orchestrator', async (column, status, constraint) => {
    await expect(
      db.execute(sql`
      insert into poll_executions (poll_id, tracking_finished_at, ${sql.identifier(column)})
      values (uuidv7(), now(), ${status})
    `),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint } });
  });
});
