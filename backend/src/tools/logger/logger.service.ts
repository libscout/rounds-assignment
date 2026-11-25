import { Injectable, type LoggerService as NestLoggerService } from '@nestjs/common';
import type { Level, Logger as PinoLogger } from 'pino';

/** Routes application and Nest logs through the configured Pino logger. */
@Injectable()
export class LoggerService implements NestLoggerService {
  /** Uses the configured Pino instance for application and Nest logs. */
  constructor(private readonly pino: PinoLogger) {}

  // ── pino-style methods ───────────────────────────────────────────

  /** Writes a trace entry with optional diagnostic fields. */
  trace(msg: string, ...args: unknown[]): void {
    this.write('trace', msg, args);
  }

  /** Writes a debug entry with optional diagnostic fields. */
  debug(msg: string, ...args: unknown[]): void {
    this.write('debug', msg, args);
  }

  /** Writes an informational entry with optional event details. */
  info(msg: string, ...args: unknown[]): void {
    this.write('info', msg, args);
  }

  /** Writes a warning with optional event details. */
  warn(msg: string, ...args: unknown[]): void {
    this.write('warn', msg, args);
  }

  /** Writes an error entry with optional exception details. */
  error(msg: string, ...args: unknown[]): void {
    this.write('error', msg, args);
  }

  /** Writes a fatal entry with optional exception details. */
  fatal(msg: string, ...args: unknown[]): void {
    this.write('fatal', msg, args);
  }

  // ── NestJS LoggerService compatibility ──────────────────────────

  /** Routes a Nest log message and its context to the info level. */
  log(message: string, ...optionalParams: unknown[]): void {
    this.info(message, ...optionalParams);
  }

  /** Routes a verbose Nest message and its context to the trace level. */
  verbose(message: string, ...optionalParams: unknown[]): void {
    this.trace(message, ...optionalParams);
  }

  /** Maps an exception, structured fields, context and remaining arguments into a Pino entry. */
  private write(level: Level, message: string, args: unknown[]): void {
    if (args.length === 0) {
      this.pino[level](message);

      return;
    }

    const fields: Record<string, unknown> = {};
    const last = args[args.length - 1];
    if (typeof last === 'string') {
      fields.context = args.pop();
    }
    const first = args[0];
    if (first instanceof Error) {
      fields.err = args.shift();
    } else if (first && typeof first === 'object' && !Array.isArray(first)) {
      Object.assign(fields, args.shift());
    }
    if (args.length) {
      fields.args = args;
    }
    this.pino[level](fields, message);
  }
}
