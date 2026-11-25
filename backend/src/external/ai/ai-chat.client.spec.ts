import { ConfigService } from '@src/tools/config';
import { EnvSchema } from '@src/tools/config/config.schema';
import { AiChatClient } from './ai-chat.client';

describe('AiChatClient', () => {
  const messages = [{ role: 'user' as const, content: 'test change' }];
  /** Creates a chat client with the provider settings for this test. */
  function client(settings: Partial<EnvSchema> = {}) {
    const env = Object.assign(new EnvSchema(), settings);

    return new AiChatClient(new ConfigService(env));
  }
  const ok = {
    choices: [{ message: { content: 'Price dropped.' }, finish_reason: 'stop' }],
  };
  afterEach(() => jest.restoreAllMocks());
  it('sends the hosted model and bearer credentials to DeepSeek with thinking disabled', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(Response.json(ok));
    const provider = client({ AI_API_KEY: 'test-only' });
    expect(await provider.complete(messages, 'p')).toEqual({
      kind: 'ready',
      text: 'Price dropped.',
    });
    const [url, args] = fetcher.mock.calls[0];
    expect(url).toEqual(new URL('https://api.deepseek.com/chat/completions'));
    expect(args.headers).toMatchObject({ authorization: 'Bearer test-only' });
    expect(JSON.parse(args.body as string)).toEqual({
      model: 'deepseek-flash',
      thinking: { type: 'disabled' },
      max_tokens: 128,
      stream: false,
      messages,
    });
  });
  it('sends the configured bearer token and model to a custom endpoint', async () => {
    const provider = client({
      AI_BASE_URL: 'https://provider.example.test/gateway/v1/',
      AI_API_KEY: 'custom-test-key',
      AI_MODEL: 'custom-model',
    });
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(Response.json(ok));
    await provider.complete(messages, 'p');
    const [url, args] = fetcher.mock.calls[0];
    expect(url).toEqual(
      new URL('https://provider.example.test/gateway/v1/chat/completions'),
    );
    expect(args.headers).toMatchObject({ authorization: 'Bearer custom-test-key' });
    expect(args.redirect).toBe('error');
    expect(JSON.parse(args.body as string)).toEqual({
      model: 'custom-model',
      messages,
      max_tokens: 128,
      stream: false,
    });
  });
  it.each([
    { model: 'deepseek/deepseek-v4.1-flash-1017', reasoning: { effort: 'none' } },
    { model: 'deepseek/deepseek-flash', reasoning: { effort: 'none' } },
    { model: 'example/other-model', reasoning: undefined },
  ])(
    'sends the 128-token limit and reasoning settings for OpenRouter model $model',
    async ({ model, reasoning }) => {
      const provider = client({
        AI_BASE_URL: 'https://openrouter.ai/api/v1',
        AI_MODEL: model,
      });
      const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(Response.json(ok));
      await provider.complete(messages, 'p');
      const body: unknown = JSON.parse(fetcher.mock.calls[0][1].body as string);
      expect(body).toEqual({
        model,
        messages,
        max_tokens: 128,
        stream: false,
        reasoning,
      });
    },
  );
  it('fails locally when the direct DeepSeek key contains only whitespace', async () => {
    const provider = client({
      AI_BASE_URL: 'https://api.deepseek.com',
      AI_API_KEY: '   ',
    });
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('unexpected call'));
    expect(provider.canSend).toBe(false);
    expect(await provider.complete(messages, 'p')).toEqual({
      kind: 'failed',
      retryable: false,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses the local mock without authentication when no AI settings are supplied', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(Response.json(ok));
    await client().complete(messages, 'p');
    const [url, args] = fetcher.mock.calls[0];
    expect(url).toEqual(new URL('http://localhost:4001/v1/chat/completions'));
    expect(args.headers).not.toHaveProperty('authorization');
    expect(JSON.parse(args.body as string)).toMatchObject({
      model: 'mock-llm',
      max_tokens: 128,
    });
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
    {
      choices: [
        { message: { refusal: 'Declined', content: 'Price' }, finish_reason: 'stop' },
      ],
    },
  ])('rejects an unusable completion', async (body) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(Response.json(body));
    expect(await client().complete(messages, 'p')).toEqual({
      kind: 'invalid_output',
      retryable: false,
    });
  });
  it.each(['length', null])(
    'rejects partial summary text when the finish reason is %s',
    async (reason) => {
      const choice = {
        finish_reason: reason,
        message: { content: 'Price changed from' },
      };
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(Response.json({ choices: [choice] }));
      expect(await client().complete(messages, 'p')).toEqual({
        kind: 'invalid_output',
        retryable: false,
      });
    },
  );
});
