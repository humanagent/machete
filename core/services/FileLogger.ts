// Effect's logs go to the log file as "HH:MM:SS.mmm message". Diagnostics only: never audio or transcript text.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
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

/** Past this the log starts over; the one before stays as `….1`. */
export const MAX_LOG_BYTES = 2_000_000;

const sizeOf = (file: string) => statSync(file, { throwIfNoEntry: false })?.size ?? 0;

export const FileLoggerLive = Layer.unwrap(
  Effect.gen(function* () {
    const { logFile } = yield* AppPaths;
    let size: number | undefined;
    const fileLogger = Logger.make(({ date, message }) => {
      try {
        if (size === undefined) {
          mkdirSync(dirname(logFile), { recursive: true });
          size = sizeOf(logFile);
        }
        if (size > MAX_LOG_BYTES) {
          renameSync(logFile, `${logFile}.1`);
          size = 0;
        }
        const line = formatLine(date, message);
        appendFileSync(logFile, line);
        size += Buffer.byteLength(line);
      } catch {
        // Logging must never break the app. Next time it looks at the folder again.
        size = undefined;
      }
    });
    return Logger.layer([fileLogger]);
  }),
);
