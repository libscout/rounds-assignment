import { TestEnv } from '@test/nest';
import { DATABASE, type Database } from '@src/tools/db';
import { watchlist } from '../entities';
import { WatchlistRepository } from '../repositories';
import { WatchlistService } from './watchlist.service';

describe('WatchlistService', () => {
  let env: TestEnv;
  let service: WatchlistService;
  let db: Database;
  beforeAll(async () => {
    env = await TestEnv.create({
      providers: [WatchlistRepository, WatchlistService],
    });
    service = env.nest.get(WatchlistService);
    db = env.nest.get(DATABASE);
  }, 180000);
  afterAll(async () => {
    await env?.cleanup();
  });
  it('keeps one schedule on concurrent adds and reactivates after removal', async () => {
    await Promise.all(Array.from({ length: 10 }, () => service.add('Demo')));
    const [first] = await db.select().from(watchlist);
    await service.add('Demo');
    expect(await db.select().from(watchlist)).toEqual([first]);
    expect(await service.list()).toEqual(['Demo']);
    await service.remove('Demo');
    await service.remove('Demo');
    expect(await service.list()).toEqual([]);
    await service.add('Demo');
    const [reactivated] = await db.select().from(watchlist);
    expect(reactivated.nextDueAt).toBeInstanceOf(Date);
    expect(reactivated).toMatchObject({ lastDispatchedPollId: null });
  });
});
