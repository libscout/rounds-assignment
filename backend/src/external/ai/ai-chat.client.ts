import { Injectable } from '@nestjs/common';
import { ConfigService } from '@src/tools/config';

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

/** Sends a single deadline-bound Chat Completions request to DeepSeek or the configured HTTP mock. */
@Injectable()
export class AiChatClient {
  private readonly endpoint: URL;

  private readonly deepseek: boolean;

  constructor(private readonly config: ConfigService) {
    const defaultBaseUrl = config.getEnv('DEEPSEEK_API_KEY')
      ? 'https://api.deepseek.com'
      : 'http://localhost:4001/v1';
    const base = config.getEnv('AI_BASE_URL') ?? defaultBaseUrl;
    this.endpoint = new URL(base.replace(/\/+$/, '') + '/chat/completions');
    this.deepseek = this.endpoint.origin === 'https://api.deepseek.com';
  }

  async complete(messages: ChatMessage[], pollId: string): Promise<ChatReply> {
    const signal = AbortSignal.timeout(10_000);
    try {
      const headers = this.headers(pollId);
      if (!headers) {
        return { kind: 'failed', retryable: false };
      }
      const response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers,
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

  private headers(pollId: string): Record<string, string> | undefined {
    const headers = { 'content-type': 'application/json', 'x-request-id': pollId };
    if (!this.deepseek) {
      return headers;
    }
    const key = this.config.getEnv('DEEPSEEK_API_KEY');
    if (key) {
      return { ...headers, authorization: 'Bearer ' + key };
    }
  }

  private requestBody(messages: ChatMessage[]) {
    const defaultModel = this.deepseek ? 'deepseek-flash' : 'mock-llm';
    const providerOptions = this.deepseek
      ? { thinking: { type: 'disabled' }, max_tokens: 128 }
      : {};

    return JSON.stringify({
      model: this.config.getEnv('AI_MODEL') ?? defaultModel,
      messages,
      stream: false,
      ...providerOptions,
    });
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

  private static summaryText(data: unknown) {
    if (!AiChatClient.isObject(data) || !Array.isArray(data.choices)) {
      return undefined;
    }
    const choice: unknown = data.choices[0];
    if (!AiChatClient.isObject(choice) || choice.finish_reason === 'length') {
      return undefined;
    }
    if (
      !AiChatClient.isObject(choice.message) ||
      typeof choice.message.content !== 'string'
    ) {
      return undefined;
    }
    const text = choice.message.content;
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
