import { expect, test } from 'bun:test';
import { dockStep } from '../../core/dock';
import { defaultSettings } from '../../core/services/Settings';

test('hidden unless someone chooses otherwise', () => {
  expect(defaultSettings.hideDock).toBe(true);
});

test('macOS is only asked when something changes', () => {
  expect(dockStep(false, true)).toBe('none');
  expect(dockStep(true, false)).toBe('none');
  expect(dockStep(true, true)).toBe('hide');
  expect(dockStep(false, false)).toBe('show');
});
