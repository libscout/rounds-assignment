import { Injectable } from '@nestjs/common';
import type { SummaryInput } from './summary-input.types';

/** Returns an empty summary so change processing can run without an external AI provider. */
@Injectable()
export class MockAiClient {
  readonly summarize: (change: SummaryInput, signal: AbortSignal) => Promise<string> = () =>
    Promise.resolve('');
}
