import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import winston from 'winston';

export const LOG_FILE_PATH = path.resolve('data', 'logs', 'backend.log');
export const LOG_MAX_BYTES = 12 * 1024 * 1024;
export const LOG_MAX_BACKUPS = 9;

type LogContext = Record<string, unknown>;

let rootLogger: winston.Logger | null = null;

function ensureLogDirectory(filePath: string): void {
  const directory = path.dirname(filePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
}

function readFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function rotateBackups(filePath: string, maxBackups: number): void {
  const oldestBackup = `${filePath}.${maxBackups}`;
  if (existsSync(oldestBackup)) {
    rmSync(oldestBackup, { force: true });
  }

  for (let index = maxBackups - 1; index >= 1; index -= 1) {
    const currentBackup = `${filePath}.${index}`;
    if (existsSync(currentBackup)) {
      renameSync(currentBackup, `${filePath}.${index + 1}`);
    }
  }

  if (existsSync(filePath)) {
    renameSync(filePath, `${filePath}.1`);
  }
}

function toBuffer(chunk: string | Uint8Array, encoding: BufferEncoding): Buffer {
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, encoding);
  }

  return Buffer.from(chunk);
}

function sanitizeInline(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stringifyLogValue(value: unknown): string {
  if (typeof value === 'string') {
    return sanitizeInline(value);
  }

  if (value instanceof Error) {
    return sanitizeInline(value.stack ?? value.message);
  }

  if (typeof value === 'object' && value !== null) {
    return sanitizeInline(JSON.stringify(value));
  }

  return String(value);
}

function serializeContext(context: LogContext): string {
  return Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      const serialized = stringifyLogValue(value);
      return /[\s=]/.test(serialized)
        ? `${key}=${JSON.stringify(serialized)}`
        : `${key}=${serialized}`;
    })
    .join(' ');
}

function resolveLogLevel(): string {
  const level = process.env.LOG_LEVEL?.trim().toLowerCase();
  return level && ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'].includes(level)
    ? level
    : 'info';
}

function buildLogLine(entry: winston.Logform.TransformableInfo): string {
  const { timestamp, level, message, area, stack, ...context } = entry;
  const inlineMessage = sanitizeInline(String(message));
  const mergedContext = {
    ...context,
    ...(stack ? { stack } : {}),
  };
  const suffix = serializeContext(mergedContext);

  return [
    `${timestamp}`,
    level.toUpperCase().padEnd(5),
    `[${String(area ?? 'app')}]`,
    inlineMessage,
    suffix,
  ]
    .filter((part) => part.length > 0)
    .join(' ');
}

function reportLoggerBootstrapFailure(error: unknown): void {
  const message = getErrorMessage(error, 'Unknown logger bootstrap failure');
  process.stderr.write(`[bountarr-logger] File logging disabled: ${message}\n`);
}

function buildReadableFormat() {
  return winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.printf(buildLogLine),
  );
}

export class RotatingFileStream extends Writable {
  private readonly filePath: string;
  private readonly maxBytes: number;
  private readonly maxBackups: number;
  private currentSize: number;

  constructor(filePath: string, maxBytes = LOG_MAX_BYTES, maxBackups = LOG_MAX_BACKUPS) {
    super();
    this.filePath = filePath;
    this.maxBytes = maxBytes;
    this.maxBackups = maxBackups;

    ensureLogDirectory(this.filePath);
    this.currentSize = readFileSize(this.filePath);
  }

  override _write(
    chunk: string | Uint8Array,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      const buffer = toBuffer(chunk, encoding);
      this.rotateIfNeeded(buffer.byteLength);
      appendFileSync(this.filePath, buffer);
      this.currentSize += buffer.byteLength;
      callback(null);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private rotateIfNeeded(incomingBytes: number): void {
    // The app requires a fixed active filename plus numbered backups, so rotate manually.
    if (this.currentSize === 0 || this.currentSize + incomingBytes <= this.maxBytes) {
      return;
    }

    rotateBackups(this.filePath, this.maxBackups);
    this.currentSize = readFileSize(this.filePath);
  }
}

function buildRootLogger(): winston.Logger {
  const level = resolveLogLevel();
  const format = buildReadableFormat();
  const transports: winston.transport[] = [
    new winston.transports.Console({
      level,
      format,
      stderrLevels: ['warn', 'error'],
    }),
  ];

  try {
    const stream = new RotatingFileStream(LOG_FILE_PATH, LOG_MAX_BYTES, LOG_MAX_BACKUPS);
    stream.on('error', reportLoggerBootstrapFailure);
    transports.unshift(
      new winston.transports.Stream({
        level,
        stream,
        format,
      }),
    );
  } catch (error) {
    reportLoggerBootstrapFailure(error);
  }

  return winston.createLogger({
    level,
    defaultMeta: {
      area: 'app',
    },
    transports,
  });
}

function getRootLogger(): winston.Logger {
  if (!rootLogger) {
    // Delay logger startup so unit tests can import helpers without touching the real log file.
    rootLogger = buildRootLogger();
  }

  return rootLogger;
}

export function createAreaLogger(area: string): winston.Logger {
  return getRootLogger().child({ area });
}

export function getErrorMessage(error: unknown, fallback = 'Unexpected error'): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }

  return fallback;
}

export function toErrorLogContext(error: unknown): LogContext {
  if (error instanceof Error) {
    return {
      error: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    error: getErrorMessage(error),
  };
}
