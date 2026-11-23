import { expect, test } from 'bun:test';
import { forget, preview, remember, search } from '../../../apps/clipboard/history';

test('a new copy goes on top; a repeated one moves up instead of repeating', () => {
  expect(remember(['b', 'a'], 'c')).toEqual(['c', 'b', 'a']);
  expect(remember(['b', 'a'], 'a')).toEqual(['a', 'b']);
});

test('the history keeps a fixed number of entries', () => {
  expect(remember(['b', 'a'], 'c', 2)).toEqual(['c', 'b']);
});

test('forget removes an entry', () => {
  expect(forget(['c', 'b', 'a'], 'b')).toEqual(['c', 'a']);
});

test('search matches every word in any order, ignoring case and accents', () => {
  const items = ['Reunión con Nick', 'https://github.com/repeapp/repe', 'nick molnar'];
  expect(search(items, 'nick reunion')).toEqual(['Reunión con Nick']);
  expect(search(items, 'NICK')).toEqual(['Reunión con Nick', 'nick molnar']);
  expect(search(items, '  ')).toEqual(items);
});

test('preview is one line and keeps both ends of long text', () => {
  expect(preview('hola\n  mundo')).toBe('hola⏎ mundo');
  const p = preview('a'.repeat(50) + 'b'.repeat(50), 21);
  expect(p).toBe(`${'a'.repeat(10)}…${'b'.repeat(10)}`);
});
