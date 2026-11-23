// Clipboard history as plain functions: newest first, no duplicates, a fixed size.
import { Schema } from 'effect';

/** How many copies are kept. */
export const HISTORY_SIZE = 200;
/** And how many characters in all: a few huge copies must not stay in memory, and be rewritten, forever. */
export const HISTORY_CHARS = 2_000_000;

export const ClipboardHistoryFile = Schema.Struct({ items: Schema.Array(Schema.String) });
export type ClipboardHistoryFile = typeof ClipboardHistoryFile.Type;

/** `text` on top; an earlier copy of the same text moves up instead of repeating. */
export const remember = (
  items: ReadonlyArray<string>,
  text: string,
  size = HISTORY_SIZE,
  chars = HISTORY_CHARS,
): ReadonlyArray<string> => {
  if (items[0] === text) return items;
  let left = chars - text.length;
  const older = items.filter((x) => x !== text).slice(0, size - 1);
  const over = older.findIndex((x) => (left -= x.length) < 0);
  return [text, ...(over === -1 ? older : older.slice(0, over))];
};

export const forget = (items: ReadonlyArray<string>, text: string): ReadonlyArray<string> =>
  items.filter((x) => x !== text);

/** Every word of the query, in any order, ignoring case and accents. */
export const search = (items: ReadonlyArray<string>, query: string): ReadonlyArray<string> => {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((x) => {
    const t = fold(x);
    return words.every((w) => t.includes(w));
  });
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** One line for the list: whitespace runs collapse, line breaks show as ⏎, long text keeps both ends. */
export const preview = (text: string, max = 60): string => {
  const line = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n/g, '⏎')
    .trim();
  if (line.length <= max) return line;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${line.slice(0, head)}…${line.slice(line.length - tail)}`;
};
