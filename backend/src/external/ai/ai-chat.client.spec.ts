import { ConfigService } from '@src/tools/config';
import { EnvSchema } from '@src/tools/config/config.schema';
import { AiChatClient } from './ai-chat.client';

describe('AiChatClient', () => {
  const messages = [{ role: 'user' as const, content: 'test change' }];
  /** Creates a chat client with a test credential and an optional endpoint override. */
  function client(url?: string) {
    return new AiChatClient(
      new ConfigService(
        Object.assign(new EnvSchema(), {
          DEEPSEEK_API_KEY: 'test-only',
          AI_BASE_URL: url,
        }),
      ),
    );
  }
  const ok = {
    choices: [{ message: { content: 'Price dropped.' }, finish_reason: 'stop' }],
  };
  afterEach(() => jest.restoreAllMocks());
  it('sends the hosted model, bounded generation settings and bearer credentials to DeepSeek', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(Response.json(ok));
    expect(await client().complete(messages, 'p')).toEqual({
      kind: 'ready',
      text: 'Price dropped.',
    });
    const [url, args] = fetcher.mock.calls[0];
    expect(url).toEqual(new URL('https://api.deepseek.com/chat/completions'));
    expect(args.headers).toMatchObject({ authorization: 'Bearer test-only' });
    expect(JSON.parse(args.body as string)).toMatchObject({
      model: 'deepseek-flash',
      thinking: { type: 'disabled' },
      max_tokens: 128,
      messages,
    });
  });
  it('isolates a missing hosted credential to the affected AI request', async () => {
    const config = new ConfigService(
      Object.assign(new EnvSchema(), { AI_BASE_URL: 'https://api.deepseek.com' }),
    );
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('unexpected call'));
    expect(await new AiChatClient(config).complete(messages, 'p')).toEqual({
      kind: 'failed',
      retryable: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves the mock URL prefix and omits the hosted credential', async () => {
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(null, { status: 429, headers: { 'Retry-After': '7' } }),
      );
    expect(await client('http://localhost:4001/v1/').complete(messages, 'p')).toEqual({
      kind: 'failed',
      retryable: true,
      retryAfter: 7000,
    });
    expect(fetcher.mock.calls[0][0]).toEqual(
      new URL('http://localhost:4001/v1/chat/completions'),
    );
    expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty('authorization');
  });
  it('applies one ten-second deadline through response body consumption', async () => {
    const controller = new AbortController();
    const timeout = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal);
    const stream = new ReadableStream({
      start(s) {
        controller.signal.addEventListener('abort', () =>
          s.error(controller.signal.reason),
        );
      },
    });
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(stream));
    const pending = client().complete(messages, 'p');
    controller.abort();
    expect(await pending).toEqual({ kind: 'timeout', retryable: true });
    expect(timeout).toHaveBeenCalledWith(10000);
  });
  it.each([
    [503, true],
    [401, false],
  ])('classifies HTTP %i', async (status, retryable) => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: Number(status) }));
    expect(await client().complete(messages, 'p')).toMatchObject({
      kind: 'failed',
      retryable,
    });
  });
  it('classifies malformed JSON and transport errors', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('{'))
      .mockRejectedValueOnce(new TypeError('reset'));
    expect(await client().complete(messages, 'p')).toEqual({
      kind: 'invalid_output',
      retryable: false,
    });
    expect(await client().complete(messages, 'p')).toEqual({
      kind: 'failed',
      retryable: true,
    });
  });
  it.each([
    {},
    { choices: [{ message: { content: '   ' } }] },
    { choices: [{ message: { content: 'bad\0text' } }] },
    { choices: [{ message: { content: 'cut' }, finish_reason: 'length' }] },
  ])('rejects an unusable completion', async (body) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(Response.json(body));
    expect(await client().complete(messages, 'p')).toEqual({
      kind: 'invalid_output',
      retryable: false,
    });
  });
});
