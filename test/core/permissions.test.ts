import { describe, expect, test } from 'bun:test';
import { besideSettings, missing, NOTHING_GRANTED, PERMISSIONS, permission } from '../../core/permissions';

describe('missing', () => {
  test('lists what is not granted, in the order the guide shows it', () => {
    expect(missing(NOTHING_GRANTED)).toEqual(['microphone', 'screen', 'accessibility', 'inputMonitoring']);
    expect(
      missing({
        microphone: 'granted',
        screen: 'granted',
        accessibility: 'denied',
        inputMonitoring: 'granted',
      }),
    ).toEqual(['accessibility']);
  });
});

test('only the microphone is granted through a prompt; the rest by dragging the app', () => {
  expect(PERMISSIONS.filter((p) => p.method === 'prompt').map((p) => p.key)).toEqual(['microphone']);
  expect(permission('inputMonitoring').pane).toEndWith('Privacy_ListenEvent');
});

describe('besideSettings', () => {
  const screen = { x: 0, y: 25, width: 1512, height: 920 };
  const guide = { width: 380, height: 470 };

  test('to the right of System Settings, bottom-aligned', () => {
    expect(besideSettings({ x: 91, y: 33, width: 723, height: 889 }, guide, screen)).toEqual({
      x: 826,
      y: 452,
    });
  });
  test('to the left when the right side has no room', () => {
    expect(besideSettings({ x: 700, y: 100, width: 723, height: 600 }, guide, screen)).toEqual({
      x: 308,
      y: 230,
    });
  });
  test('kept on screen when neither side fits', () => {
    const at = besideSettings({ x: 100, y: 0, width: 1400, height: 2000 }, guide, screen);
    expect(at).toEqual({ x: 1120, y: 463 });
  });
});
