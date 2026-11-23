import { describe, expect, test } from 'bun:test';
import { APPS } from '../../apps';
import { canonical, fromPress, fromTap, HOTKEYS, isAlone, keysOf, label, takenBy } from '../../core/hotkeys';

const press = (code: string, mods = '') => ({
  code,
  ctrlKey: mods.includes('c'),
  altKey: mods.includes('a'),
  shiftKey: mods.includes('s'),
  metaKey: mods.includes('m'),
});

describe('shortcuts', () => {
  test('no two defaults share keys, and every program has at least one', () => {
    const all = HOTKEYS.flatMap((k) => k.keys.map(canonical));
    expect(new Set(all).size).toBe(all.length);
    for (const { id } of APPS) expect(HOTKEYS.some((k) => k.app === id)).toBe(true);
  });

  test('one spelling per combination', () => {
    expect(canonical('Cmd+Shift+d')).toBe('Shift+CommandOrControl+D');
    expect(canonical('Option+Enter')).toBe('Alt+Return');
  });

  test('shown with the Mac’s signs, in its order', () => {
    expect(label('Shift+CommandOrControl+D')).toBe('⇧⌘D');
    expect(label('CommandOrControl+Alt+Shift+Control+Return')).toBe('⌃⌥⇧⌘↩');
    expect(label('Alt+Space')).toBe('⌥Space');
  });

  test('recorded keys replace the defaults; an empty list turns it off', () => {
    const calc = HOTKEYS.find((k) => k.id === 'calculator.toggle')!;
    expect(keysOf(calc, {})).toEqual(['Shift+CommandOrControl+D']);
    expect(keysOf(calc, { 'calculator.toggle': ['Alt+K'] })).toEqual(['Alt+K']);
    expect(keysOf(calc, { 'calculator.toggle': [] })).toEqual([]);
  });

  test('keys that belong to another action are found, its own are not', () => {
    expect(takenBy('calculator.toggle', 'Shift+Cmd+V', {})?.id).toBe('clipboard.toggle');
    expect(takenBy('calculator.toggle', 'Shift+Cmd+D', {})).toBeUndefined();
    // Freed by moving the clipboard somewhere else.
    expect(takenBy('calculator.toggle', 'Shift+Cmd+V', { 'clipboard.toggle': ['Alt+V'] })).toBeUndefined();
    expect(takenBy('calculator.toggle', 'Alt+V', { 'clipboard.toggle': ['Alt+V'] })?.id).toBe(
      'clipboard.toggle',
    );
  });
});

describe('recording', () => {
  test('a press becomes an accelerator', () => {
    expect(fromPress(press('KeyD', 'sm'), true)).toEqual({ keys: 'Shift+CommandOrControl+D' });
    expect(fromPress(press('Enter', 'a'), true)).toEqual({ keys: 'Alt+Return' });
    expect(fromPress(press('BracketLeft', 'm'), true)).toEqual({ keys: 'CommandOrControl+[' });
    expect(fromPress(press('KeyA', 'c'), true)).toEqual({ keys: 'Control+A' });
    expect(fromPress(press('Digit4', 'sm'), true)).toEqual({ keys: 'Shift+CommandOrControl+4' });
    expect(fromPress(press('F13'), true)).toEqual({ keys: 'F13' });
  });

  test('⌃ is the main modifier outside the Mac', () => {
    expect(fromPress(press('KeyD', 'cs'), false)).toEqual({ keys: 'Shift+CommandOrControl+D' });
  });

  test('waits while only modifiers are down, and refuses keys you type with', () => {
    expect(fromPress(press('ShiftLeft', 's'), true)).toBeUndefined();
    expect(fromPress(press('KeyD'), true)).toEqual({ problem: 'Add ⌘, ⌥ or ⌃' });
    expect(fromPress(press('KeyD', 's'), true)).toEqual({ problem: 'Add ⌘, ⌥ or ⌃' });
    expect(fromPress(press('MediaPlayPause', 'm'), true)).toHaveProperty('problem');
  });

  test('a right-hand modifier can be used on its own, a left one can’t', () => {
    expect(fromTap('MetaRight')).toEqual({ keys: 'RightCommand' });
    expect(fromTap('AltRight')).toEqual({ keys: 'RightAlt' });
    expect(fromTap('MetaLeft')).toHaveProperty('problem');
    expect(fromTap('KeyD')).toBeUndefined();
    expect(isAlone('RightCommand')).toBe(true);
    expect(isAlone('Alt+D')).toBe(false);
    expect(label('RightCommand')).toBe('right ⌘');
    expect(takenBy('calculator.toggle', 'RightAlt', {})?.id).toBe('dictation.toggle');
  });

  test('what is recorded can be shown and compared', () => {
    for (const { keys } of HOTKEYS) for (const k of keys) expect(canonical(canonical(k))).toBe(canonical(k));
  });
});
