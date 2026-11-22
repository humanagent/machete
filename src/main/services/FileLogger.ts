// Effect's logs go to the log file as "HH:MM:SS.mmm message". Diagnostics only: never audio or transcript text.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Effect, Layer, Logger } from 'effect';
import { AppPaths } from './AppPaths';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export const formatLine = (date: Date, message: unknown): string => {
  const text = (Array.isArray(message) ? message : [message])
    .map((m) => (typeof m === 'string' ? m : JSON.stringify(m)))
    .join(' ');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  return `${time} ${text}\n`;
};

export const FileLoggerLive = Layer.unwrap(
  Effect.gen(function* () {
    const { logFile } = yield* AppPaths;
    const fileLogger = Logger.make(({ date, message }) => {
      try {
        mkdirSync(dirname(logFile), { recursive: true });
        appendFileSync(logFile, formatLine(date, message));
      } catch {
        // Logging must never break the app.
      }
    });
    return Logger.layer([fileLogger]);
  }),
);
