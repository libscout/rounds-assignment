import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { GenericContainer, Wait } from 'testcontainers';

export async function request(url, { method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(5000),
    headers: body && { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, status, `${method} ${url} returned ${response.status}`);
  return response;
}

export async function eventually(description, check, timeout = 15000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await delay(100);
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for ${description}`);
}

async function availablePort() {
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

export async function startStack(resources) {
  const db = await new GenericContainer('postgres:18.4-alpine')
    .withEnvironment({ POSTGRES_PASSWORD: 'test' })
    .withExposedPorts(5432)
    .withHealthCheck({
      test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U postgres'],
      interval: 1000,
      timeout: 3000,
      retries: 30,
      startPeriod: 1000,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .start();
  resources.defer(() => db.stop());

  const sourceDir = fileURLToPath(
    new URL('../../../assignment/files/listing-source/', import.meta.url),
  );
  const source = await new GenericContainer('node:26.13.1-bookworm-slim')
    .withBindMounts([{ source: sourceDir, target: '/source', mode: 'ro' }])
    .withWorkingDir('/source')
    .withCommand(['node', 'listing-source-server.mjs'])
    .withEnvironment({ SEED: '42' })
    .withExposedPorts(4002)
    .withWaitStrategy(Wait.forHttp('/health', 4002))
    .start();
  resources.defer(() => source.stop());
  const sourceUrl = `http://${source.getHost()}:${source.getMappedPort(4002)}`;
  const port = await availablePort();
  const child = spawn(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register', 'src/main.ts'],
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        IS_LOCAL_ENV: 'false',
        DB_HOST: db.getHost(),
        DB_PORT: String(db.getMappedPort(5432)),
        DB_DATABASE: 'postgres',
        DB_USER: 'postgres',
        DB_PASSWORD: 'test',
        LISTING_SOURCE_URL: sourceUrl,
        POLL_INTERVAL_MS: '450',
        POLL_TIMEOUT_MS: '700',
        POLL_CONCURRENCY: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      logs = (logs + chunk).slice(-5000);
    });
  }
  const exited = once(child, 'exit');
  resources.defer(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    }
  });
  const api = `http://127.0.0.1:${port}/api/competitors`;
  await eventually(
    'Nest HTTP startup',
    async () => {
      if (child.exitCode !== null || child.signalCode)
        assert.fail(`Nest exited during startup:\n${logs}`);
      try {
        return (await fetch(api, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        return false;
      }
    },
    30000,
  );
  return { api, sourceUrl };
}
