// Snippets as plain functions: an abbreviation and the text it becomes.
import { Schema } from 'effect';

export const Snippet = Schema.Struct({
  id: Schema.String,
  abbreviation: Schema.String,
  content: Schema.String,
});
export type Snippet = typeof Snippet.Type;

export const SnippetsFile = Schema.Struct({ items: Schema.Array(Snippet) });

/** Matches the abbreviation or the text: every word, any order, ignoring case and accents. */
export const search = (items: ReadonlyArray<Snippet>, query: string): ReadonlyArray<Snippet> => {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((s) => {
    const t = fold(`${s.abbreviation} ${s.content}`);
    return words.every((w) => t.includes(w));
  });
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** What the helper expands: snippets with both an abbreviation and some text. */
export const expansions = (items: ReadonlyArray<Snippet>) =>
  items
    .filter((s) => s.abbreviation.trim() !== '' && s.content !== '')
    .map((s) => ({ abbreviation: s.abbreviation.trim(), content: s.content }));

/** Adds imported snippets, skipping abbreviations already there. Returns the list and how many were added. */
export const merge = (
  items: ReadonlyArray<Snippet>,
  incoming: ReadonlyArray<Omit<Snippet, 'id'>>,
  newId: () => string,
): readonly [ReadonlyArray<Snippet>, number] => {
  const taken = new Set(items.map((s) => s.abbreviation));
  const added = incoming
    .filter((s) => s.abbreviation !== '' && !taken.has(s.abbreviation) && (taken.add(s.abbreviation), true))
    .map((s) => ({ id: newId(), abbreviation: s.abbreviation, content: s.content }));
  return [[...items, ...added], added.length] as const;
};
