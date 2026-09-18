import pino, { type Logger, type LoggerOptions } from 'pino';
import { currentLogContext } from './correlation';
import { redact, redactString } from './redaction';

export type { Logger } from 'pino';

export interface LoggerConfig {
  app: 'api' | 'worker' | 'host-probe' | 'seed' | 'cli';
  env: string;
  version: string;
  bootId: string;
  level?: string | undefined;
  /** Test hook: a destination stream capturing JSON lines. */
  destination?: pino.DestinationStream;
}

/**
 * JSON-to-stdout logger (OBSERVABILITY.md §2). Every object argument and every message string passes
 * through redaction before serialization; request/response bodies are never logged by callers.
 */
export function createLogger(config: LoggerConfig): Logger {
  const level = config.level ?? (config.env === 'production' ? 'info' : 'debug');
  const options: LoggerOptions = {
    level,
    base: { app: config.app, env: config.env, version: config.version, bootId: config.bootId },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
    mixin() {
      return { ...currentLogContext() };
    },
    formatters: {
      level: (label) => ({ level: label }),
      log: (object) => redact(object) as Record<string, unknown>,
    },
    serializers: { err: (e: unknown) => redact(e), error: (e: unknown) => redact(e) },
    hooks: {
      logMethod(args, method) {
        const redacted = args.map((a) => (typeof a === 'string' ? redactString(a) : a)) as Parameters<
          typeof method
        >;
        method.apply(this, redacted);
      },
    },
  };
  return config.destination ? pino(options, config.destination) : pino(options);
}
