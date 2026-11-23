import { expect, test } from 'bun:test';
import { forget, preview, remember, search } from '../../../apps/clipboard/history';

test('a new copy goes on top; a repeated one moves up instead of repeating', () => {
  expect(remember(['b', 'a'], 'c')).toEqual(['c', 'b', 'a']);
  expect(remember(['b', 'a'], 'a')).toEqual(['a', 'b']);
});

test('the history keeps a fixed number of entries', () => {
  expect(remember(['b', 'a'], 'c', 2)).toEqual(['c', 'b']);
});

test('a few huge copies push the oldest ones out; the newest always stays', () => {
  const big = 'x'.repeat(60);
  expect(remember([big, 'b', 'a'], 'c', 200, 70)).toEqual(['c', big, 'b', 'a']);
  expect(remember([big, 'b', 'a'], 'cccccccccc', 200, 70)).toEqual(['cccccccccc', big]);
  expect(remember(['a'], big, 200, 10)).toEqual([big]);
});

test('copying what is already on top changes nothing', () => {
  const items = ['b', 'a'];
  expect(remember(items, 'b')).toBe(items);
});

test('forget removes an entry', () => {
  expect(forget(['c', 'b', 'a'], 'b')).toEqual(['c', 'a']);
});

test('search matches every word in any order, ignoring case and accents', () => {
  const items = ['Reunión con Ana', 'https://example.com/page', 'ana gómez'];
  expect(search(items, 'ana reunion')).toEqual(['Reunión con Ana']);
  expect(search(items, 'ANA')).toEqual(['Reunión con Ana', 'ana gómez']);
  expect(search(items, '  ')).toEqual(items);
});

test('preview is one line and keeps both ends of long text', () => {
  expect(preview('hola\n  mundo')).toBe('hola⏎ mundo');
  const p = preview('a'.repeat(50) + 'b'.repeat(50), 21);
  expect(p).toBe(`${'a'.repeat(10)}…${'b'.repeat(10)}`);
});
