import { Injectable, type LoggerService as NestLoggerService } from '@nestjs/common';
import type { Level, Logger as PinoLogger } from 'pino';

/** Routes application and Nest logs through the configured Pino logger. */
@Injectable()
export class LoggerService implements NestLoggerService {
  constructor(private readonly pino: PinoLogger) {}

  // ── pino-style methods ───────────────────────────────────────────

  trace(msg: string, ...args: unknown[]): void {
    this.write('trace', msg, args);
  }

  debug(msg: string, ...args: unknown[]): void {
    this.write('debug', msg, args);
  }

  info(msg: string, ...args: unknown[]): void {
    this.write('info', msg, args);
  }

  warn(msg: string, ...args: unknown[]): void {
    this.write('warn', msg, args);
  }

  error(msg: string, ...args: unknown[]): void {
    this.write('error', msg, args);
  }

  fatal(msg: string, ...args: unknown[]): void {
    this.write('fatal', msg, args);
  }

  // ── NestJS LoggerService compatibility ──────────────────────────

  log(message: string, ...optionalParams: unknown[]): void {
    this.info(message, ...optionalParams);
  }

  verbose(message: string, ...optionalParams: unknown[]): void {
    this.trace(message, ...optionalParams);
  }

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
    if (args.length) fields.args = args;
    this.pino[level](fields, message);
  }
}
