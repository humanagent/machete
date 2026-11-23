import { expect, test } from 'bun:test';
import { expansions, merge, search } from '../../../src/products/snippets/snippets';

const s = (id: string, abbreviation: string, content: string) => ({ id, abbreviation, content });

test('search looks at the abbreviation and the text', () => {
  const items = [s('1', ';sig', 'Saludos, Fabrizio'), s('2', 'gg', 'mail@example.com')];
  expect(search(items, 'sig').map((x) => x.id)).toEqual(['1']);
  expect(search(items, 'EXAMPLE').map((x) => x.id)).toEqual(['2']);
  expect(search(items, '')).toEqual(items);
});

test('only snippets with an abbreviation and text are expanded', () => {
  expect(expansions([s('1', ' gg ', 'x'), s('2', '', 'y'), s('3', 'zz', '')])).toEqual([
    { abbreviation: 'gg', content: 'x' },
  ]);
});

test('merge adds new abbreviations and skips ones already there', () => {
  let n = 0;
  const [next, added] = merge(
    [s('1', 'gg', 'x')],
    [
      { abbreviation: 'gg', content: 'other' },
      { abbreviation: 'omw', content: 'On my way!' },
      { abbreviation: 'omw', content: 'dup' },
    ],
    () => `new${++n}`,
  );
  expect(added).toBe(1);
  expect(next).toEqual([s('1', 'gg', 'x'), s('new1', 'omw', 'On my way!')]);
});
