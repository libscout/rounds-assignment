import { Injectable } from '@nestjs/common';
import { ConfigService } from '@src/tools/config';

const MAX_COMPLETION_TOKENS = 128;

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ReadyChatReply {
  kind: 'ready';
  text: string;
}

interface ChatFailureDetails {
  retryable: boolean;
  retryAfter?: number;
}

export interface TimeoutChatReply extends ChatFailureDetails {
  kind: 'timeout';
}

export interface FailedChatReply extends ChatFailureDetails {
  kind: 'failed';
}

export interface InvalidOutputChatReply extends ChatFailureDetails {
  kind: 'invalid_output';
}

export type ChatReply =
  ReadyChatReply | TimeoutChatReply | FailedChatReply | InvalidOutputChatReply;

/** Sends a deadline-bound request to the configured Chat Completions endpoint. */
@Injectable()
export class AiChatClient {
  private readonly endpoint: URL;

  private readonly deepseek: boolean;

  private readonly apiKey?: string;

  readonly canSend: boolean;

  readonly usesLiveProvider: boolean;

  constructor(private readonly config: ConfigService) {
    this.apiKey = config.getEnv('AI_API_KEY')?.trim();
    const defaultBaseUrl = this.apiKey
      ? 'https://api.deepseek.com'
      : 'http://localhost:4001/v1';
    const base = config.getEnv('AI_BASE_URL') ?? defaultBaseUrl;
    this.endpoint = new URL(base.replace(/\/+$/, '') + '/chat/completions');
    this.deepseek = this.endpoint.origin === 'https://api.deepseek.com';
    this.canSend = !this.deepseek || Boolean(this.apiKey);
    this.usesLiveProvider =
      this.endpoint.origin !== new URL(config.getEnv('MOCK_LLM_TARGET')).origin;
  }

  /** Sends one completion when the configured endpoint has its required credentials. */
  async complete(messages: ChatMessage[], pollId: string): Promise<ChatReply> {
    if (!this.canSend) {
      return { kind: 'failed', retryable: false };
    }
    const signal = AbortSignal.timeout(10_000);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: this.headers(pollId),
        signal,
        body: this.requestBody(messages),
      });

      return await AiChatClient.readResponse(response);
    } catch (error) {
      if (signal.aborted) {
        return { kind: 'timeout', retryable: true };
      }
      if (error instanceof SyntaxError) {
        return { kind: 'invalid_output', retryable: false };
      }

      return { kind: 'failed', retryable: true };
    }
  }

  /** Adds the selected provider's bearer token when configured. */
  private headers(pollId: string): Record<string, string> {
    const headers = { 'content-type': 'application/json', 'x-request-id': pollId };
    if (this.apiKey) {
      return { ...headers, authorization: 'Bearer ' + this.apiKey };
    }

    return headers;
  }

  private requestBody(messages: ChatMessage[]) {
    const defaultModel = this.deepseek ? 'deepseek-flash' : 'mock-llm';
    const model = this.config.getEnv('AI_MODEL') ?? defaultModel;

    return JSON.stringify({
      model,
      messages,
      max_tokens: MAX_COMPLETION_TOKENS,
      stream: false,
      ...this.reasoningOptions(model),
    });
  }

  /** Disables optional reasoning on the DeepSeek endpoints so the token budget goes to the summary. */
  private reasoningOptions(model: string) {
    if (this.deepseek) {
      return { thinking: { type: 'disabled' } };
    }
    const flash =
      model === 'deepseek/deepseek-flash' ||
      model.startsWith('deepseek/deepseek-v4.1-flash');
    if (this.endpoint.origin === 'https://openrouter.ai' && flash) {
      return { reasoning: { effort: 'none' } };
    }

    return {};
  }

  private static async readResponse(response: Response): Promise<ChatReply> {
    if (!response.ok) {
      const retryAfter = AiChatClient.retryDelay(response.headers.get('retry-after'));
      await response.body?.cancel();

      return {
        kind: 'failed',
        retryable: response.status === 429 || response.status >= 500,
        retryAfter,
      };
    }
    const data: unknown = JSON.parse(await response.text());
    const text = AiChatClient.summaryText(data);
    if (!text) {
      return { kind: 'invalid_output', retryable: false };
    }

    return { kind: 'ready', text };
  }

  /** Extracts the summary from a completed, non-refused text reply. */
  private static summaryText(data: unknown) {
    if (!AiChatClient.isObject(data) || !Array.isArray(data.choices)) {
      return undefined;
    }
    const choice: unknown = data.choices[0];
    if (!AiChatClient.isObject(choice)) {
      return undefined;
    }
    const { finish_reason: reason, message } = choice;
    if (reason !== undefined && reason !== 'stop') {
      return undefined;
    }
    if (!AiChatClient.isObject(message) || message.refusal) {
      return undefined;
    }
    const text = message.content;
    if (typeof text !== 'string') {
      return undefined;
    }
    if (text.includes('\0') || /[\uD800-\uDFFF]/gu.test(text)) {
      return undefined;
    }

    return text.trim();
  }

  /** Narrows a provider response object before its properties are inspected. */
  private static isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private static retryDelay(value: string | null) {
    if (!value) {
      return undefined;
    }
    const ms = /^\d+$/.test(value)
      ? Number(value) * 1000
      : Date.parse(value) - Date.now();

    return Number.isFinite(ms) && ms >= 0 && ms < 8.64e15 - Date.now() ? ms : undefined;
  }
}
