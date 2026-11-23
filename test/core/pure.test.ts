// Pure helpers of the Electron layer and the logger (no Electron needed).
import { expect, test } from 'bun:test';
import { formatLine } from '../../core/services/FileLogger';

test('log lines are "HH:MM:SS.mmm message"', () => {
  const date = new Date(2026, 10, 21, 9, 5, 7, 42);
  expect(formatLine(date, 'app: launch')).toBe('09:05:07.042 app: launch\n');
  expect(formatLine(date, ['a', { b: 1 }])).toBe('09:05:07.042 a {"b":1}\n');
});
