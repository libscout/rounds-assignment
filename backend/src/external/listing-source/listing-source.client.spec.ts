import { createServer, type Server, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@src/tools/config';
import { EnvSchema } from '@src/tools/config/config.schema';
import { ListingSourceClient } from './listing-source.client';

describe('listing source HTTP adapter', () => {
  let server: Server;
  let client: ListingSourceClient;
  let handler: RequestListener;
  const fields = { title: 'CRM', price: '$9/mo', tagline: 'a', description: 'b' };
  beforeAll(async () => {
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const config = Object.assign(new EnvSchema(), {
      LISTING_SOURCE_URL: 'http://127.0.0.1:' + (server.address() as AddressInfo).port,
      POLL_TIMEOUT_MS: 350,
    });
    client = new ListingSourceClient(new ConfigService(config));
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('encodes the ID, propagates the request ID, and returns the decoded source payload', async () => {
    let received: string;
    let requestId: string | string[];
    handler = (req, res) => {
      received = req.url;
      requestId = req.headers['x-request-id'];
      res.end(JSON.stringify({ id: 'a/b ?', ...fields, noise: 'x' }));
    };
    expect(await client.fetchListing('a/b ?', 'p')).toEqual({
      httpStatus: 200,
      body: { id: 'a/b ?', ...fields, noise: 'x' },
    });
    expect(received).toBe('/listings/a%2Fb%20%3F');
    expect(requestId).toBe('p');
  });
  it.each([404, 429, 502])(
    'returns HTTP %i and the source Retry-After header verbatim',
    async (status) => {
      handler = (_req, res) => {
        res.writeHead(status, { 'Retry-After': '2' });
        res.end('<html>');
      };
      const output = status === 404 ? undefined : '<html>';
      expect(await client.fetchListing('a', 'p')).toEqual({
        httpStatus: status,
        retryAfter: '2',
        output,
      });
    },
  );

  it('reports a 429 before its body arrives and reads at most 4096 bytes of it', async () => {
    const preview = 'é'.repeat(2048);
    let sendBody: () => void;
    handler = (_req, res) => {
      sendBody = () => res.end(preview + 'more');
      res.writeHead(429, { 'Retry-After': '2' });
      res.flushHeaders();
    };
    const onRateLimited = jest.fn(() => sendBody());
    const response = await client.fetchListing('a', 'p', onRateLimited);
    expect(onRateLimited).toHaveBeenCalledWith('2');
    expect(response).toEqual({ httpStatus: 429, retryAfter: '2', output: preview });
  });

  it('preserves the status when a successful response contains malformed JSON', async () => {
    handler = (_req, res) => res.end('invalid json');
    expect(await client.fetchListing('a', 'p')).toEqual({
      httpStatus: 200,
      output: 'invalid json',
    });
  });

  it('reports a connection closed before headers as a network failure', async () => {
    handler = (req) => req.socket.destroy();
    expect(await client.fetchListing('a', 'p')).toMatchObject({ failure: 'network' });
  });

  it('aborts a stalled response body', async () => {
    handler = (_req, res) => {
      res.writeHead(200);
      res.write('{');
    };
    expect(await client.fetchListing('a', 'p')).toMatchObject({
      failure: 'timeout',
      httpStatus: 200,
    });
  });
});
