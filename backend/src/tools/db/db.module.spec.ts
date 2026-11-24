import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { MIGRATIONS_FOLDER } from './migrations.const';
import { pollAttempts, sourceState, watchlist } from '@src/modules/tracking/entities';
import { OutcomeKind, PollStatus } from '@src/modules/tracking/types';
import { TestEnv } from '@test/nest';
import { DATABASE, type Database } from './db.module';

describe('tracking database', () => {
  let env: TestEnv;
  let db: Database;

  beforeAll(async () => {
    env = await TestEnv.create();
    db = env.nest.get<Database>(DATABASE);
  }, 180_000);

  afterAll(async () => {
    await env?.cleanup();
  });

  it('preserves the shared cooldown across repeated migration runs', async () => {
    expect(await db.select().from(sourceState)).toEqual([{ id: 1, cooldownUntil: null }]);
    const deadline = new Date('2030-01-01T12:00:00Z');
    await db.update(sourceState).set({ cooldownUntil: deadline }).where(eq(sourceState.id, 1));
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(await db.select().from(sourceState)).toEqual([{ id: 1, cooldownUntil: deadline }]);
  });

  it('requires a due time exactly when tracking is active', async () => {
    await db.insert(watchlist).values({ id: 'paused', active: false });
    for (const row of [
      { id: 'active-without-date', active: true },
      { id: 'paused-with-date', active: false, nextDueAt: new Date() },
    ]) {
      await expect(db.insert(watchlist).values(row)).rejects.toMatchObject({
        cause: { constraint: 'watchlist_active_due' },
      });
    }
  });

  it('enforces one outstanding attempt per listing and validates terminal outcomes', async () => {
    await db.insert(watchlist).values({ id: 'acme', nextDueAt: new Date() });
    const attempt = { competitorId: 'acme', attemptNo: 1 };
    const [row] = await db.insert(pollAttempts).values(attempt).returning();
    await expect(db.insert(pollAttempts).values(attempt)).rejects.toMatchObject({
      cause: { code: '23505' },
    });
    await expect(
      db
        .update(pollAttempts)
        .set({ status: PollStatus.Success })
        .where(eq(pollAttempts.id, row.id)),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    const finishedAt = new Date();
    await expect(
      db
        .update(pollAttempts)
        .set({ status: PollStatus.Success, finishedAt, nextDeliveryAt: finishedAt })
        .where(eq(pollAttempts.id, row.id)),
    ).rejects.toMatchObject({ cause: { constraint: 'poll_attempts_lifecycle' } });
    await db
      .update(pollAttempts)
      .set({
        status: PollStatus.Success,
        outcomeKind: OutcomeKind.Missing,
        httpStatus: 404,
        finishedAt,
        nextDeliveryAt: finishedAt,
      })
      .where(eq(pollAttempts.id, row.id));
    expect(await db.select().from(pollAttempts)).toMatchObject([
      { outcomeKind: OutcomeKind.Missing },
    ]);
  });
});
