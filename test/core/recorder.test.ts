import { describe, expect, test } from 'bun:test';
import type { Pressed } from '../../core/hotkeys';
import { IDLE, press, type Recorder, release, startRecording, type Step } from '../../core/recorder';

const key = (code: string, mods = ''): Pressed => ({
  code,
  ctrlKey: mods.includes('c'),
  altKey: mods.includes('a'),
  shiftKey: mods.includes('s'),
  metaKey: mods.includes('m'),
});
const ID = 'dictation.toggle';
/** Plays presses and releases ("-Code") and returns where it ended. */
const play = (...steps: ReadonlyArray<Pressed | string>): Step => {
  let last: Step = { next: startRecording(ID) };
  for (const s of steps) last = typeof s === 'string' ? release(last.next, s) : press(last.next, s, true);
  return last;
};

describe('recording a shortcut', () => {
  test('right ⌘ on its own', () => {
    expect(play(key('MetaRight', 'm'), 'MetaRight')).toEqual({ next: IDLE, keys: 'RightCommand' });
  });

  test('right ⌘ held with a letter is the combination', () => {
    const end = play(key('MetaRight', 'm'), key('KeyJ', 'm'));
    expect(end).toEqual({ next: IDLE, keys: 'CommandOrControl+J' });
    // Letting go afterwards changes nothing.
    expect(release(end.next, 'MetaRight')).toEqual({ next: IDLE });
  });

  test('two modifiers together aren’t one on its own', () => {
    const { next, keys } = play(key('MetaRight', 'm'), key('ShiftLeft', 'ms'), 'ShiftLeft', 'MetaRight');
    expect(keys).toBeUndefined();
    expect(next.id).toBe(ID);
  });

  test('a left modifier on its own, or a bare letter, says why and keeps listening', () => {
    for (const { next, keys } of [play(key('MetaLeft', 'm'), 'MetaLeft'), play(key('KeyD'))]) {
      expect(keys).toBeUndefined();
      expect(next.id).toBe(ID);
      expect(next.problem).not.toBe('');
    }
  });

  test('a good press after a bad one works', () => {
    expect(play(key('KeyD'), key('KeyD', 'a')).keys).toBe('Alt+D');
  });

  test('Esc cancels; ⌘Esc is a combination', () => {
    expect(play(key('Escape'))).toEqual({ next: IDLE });
    expect(play(key('Escape', 'm')).next.id).toBe(ID);
  });

  test('nothing happens while it isn’t recording', () => {
    expect(press(IDLE, key('KeyD', 'm'), true)).toEqual({ next: IDLE });
    expect(release(IDLE as Recorder, 'MetaRight')).toEqual({ next: IDLE });
  });
});
