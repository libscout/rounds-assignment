import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { GenericContainer, Wait } from 'testcontainers';

/** Sends a deadline-bound HTTP request and asserts the expected response status. */
export async function request(
  url: string,
  {
    method = 'GET',
    body,
    status = 200,
  }: {
    method?: string;
    body?: Record<string, unknown>;
    status?: number;
  } = {},
) {
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(5000),
    headers: body && { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, status, `${method} ${url} returned ${response.status}`);

  return response;
}

/** Repeats a check until it returns a truthy result or its deadline expires. */
export async function eventually<T>(
  description: string,
  check: () => Promise<T | false | undefined>,
  timeout = 15000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  do {
    const result = await check();
    if (result) {
      return result;
    }
    await delay(100);
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for ${description}`);
}

/** Asks the operating system for a free loopback port and releases the temporary listener. */
async function availablePort() {
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }),
  );

  return address.port;
}

/** Starts PostgreSQL, the mock services and the API, registering each for cleanup. */
export async function startStack(
  resources: AsyncDisposableStack,
  pollIntervalMs = 450,
) {
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
  resources.defer(async () => {
    await db.stop();
  });

  const sourceDir = resolve(__dirname, '../../../assignment/files/listing-source');
  const source = await new GenericContainer('node:26.13.1-bookworm-slim')
    .withBindMounts([{ source: sourceDir, target: '/source', mode: 'ro' }])
    .withWorkingDir('/source')
    .withCommand(['node', 'listing-source-server.mjs'])
    .withEnvironment({ SEED: '42' })
    .withExposedPorts(4002)
    .withWaitStrategy(Wait.forHttp('/health', 4002))
    .start();
  resources.defer(async () => {
    await source.stop();
  });
  const sourceUrl = `http://${source.getHost()}:${source.getMappedPort(4002)}`;
  const llmDir = resolve(__dirname, '../../../assignment/files/mock-llm');
  const llm = await new GenericContainer('python:3.13-alpine')
    .withBindMounts([{ source: llmDir, target: '/mock', mode: 'ro' }])
    .withWorkingDir('/mock')
    .withCommand(['python', '-u', 'mock-llm-server.py'])
    .withExposedPorts(4001)
    .withWaitStrategy(Wait.forHttp('/health', 4001))
    .start();
  resources.defer(async () => {
    await llm.stop();
  });
  const llmUrl = `http://${llm.getHost()}:${llm.getMappedPort(4001)}`;
  const port = await availablePort();
  const child = spawn(
    process.execPath,
    [
      '-r',
      'ts-node/register/transpile-only',
      '-r',
      'tsconfig-paths/register',
      'src/main.ts',
    ],
    {
      cwd: resolve(__dirname, '../..'),
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
        AI_BASE_URL: llmUrl + '/v1',
        AI_API_KEY: '',
        AI_MODEL: 'mock-llm',
        DEMO_RESET_ENABLED: 'true',
        MOCK_SOURCE_TARGET: sourceUrl,
        MOCK_LLM_TARGET: llmUrl,
        ORCHESTRATOR_INTERVAL_MS: '100',
        POLL_INTERVAL_MS: String(pollIntervalMs),
        POLL_TIMEOUT_MS: '700',
        POLL_CONCURRENCY: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk: Buffer) => {
      logs = (logs + chunk.toString()).slice(-5000);
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
      if (child.exitCode !== null || child.signalCode) {
        assert.fail(`Nest exited during startup:\n${logs}`);
      }
      try {
        return (await fetch(api, { signal: AbortSignal.timeout(1000) })).ok;
      } catch {
        return false;
      }
    },
    30000,
  );

  return { api, sourceUrl, llmUrl };
}
