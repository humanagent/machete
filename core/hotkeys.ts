// Every shortcut Machete has, from the apps' manifests. Plus the plain functions to compare, show and record keys.
// Keys are Electron accelerators ("Shift+CommandOrControl+D") or a right-hand modifier on its own.
import { Schema } from 'effect';
import { APPS } from '../apps';

/** "<app>.<shortcut>" */
export type HotkeyID = `${string}.${string}`;

export interface HotkeyInfo {
  readonly id: HotkeyID;
  readonly app: string;
  readonly title: string;
  readonly keys: ReadonlyArray<string>;
}

export const HOTKEYS: ReadonlyArray<HotkeyInfo> = APPS.flatMap((app) =>
  app.shortcuts.map(({ name, title, keys }) => ({
    id: `${app.id}.${name}` as const,
    app: app.id,
    title,
    keys,
  })),
);
export const isHotkey = (id: string): id is HotkeyID => HOTKEYS.some((k) => k.id === id);

/** The keys you changed: an action that isn't here has its defaults; an empty list turns it off. */
export const HotkeyChanges = Schema.Record(Schema.String, Schema.Array(Schema.String));
export type HotkeyChanges = typeof HotkeyChanges.Type;

export const keysOf = (info: HotkeyInfo, changes: HotkeyChanges): ReadonlyArray<string> =>
  changes[info.id] ?? info.keys;

// MARK: Modifiers on their own

/** Right-hand modifiers, tapped alone. Not Electron accelerators: the helper reports them. */
const ALONE: Readonly<Record<string, string>> = {
  RightAlt: 'right ⌥',
  RightCommand: 'right ⌘',
  RightControl: 'right ⌃',
  RightShift: 'right ⇧',
};
export const isAlone = (keys: string) => keys in ALONE;

// MARK: Accelerators

const MODIFIERS = ['Control', 'Alt', 'Shift', 'CommandOrControl'] as const;
const SAME: Readonly<Record<string, string>> = {
  Ctrl: 'Control',
  Option: 'Alt',
  Command: 'CommandOrControl',
  Cmd: 'CommandOrControl',
  CmdOrCtrl: 'CommandOrControl',
  Enter: 'Return',
};

/** One spelling per combination, so two can be compared. */
export const canonical = (accelerator: string): string => {
  // "+" itself can't be a key here: it is always Shift and "=".
  const parts = accelerator.split('+').map((p) => SAME[p] ?? p);
  const last = parts.at(-1) ?? '';
  return [
    ...MODIFIERS.filter((m) => parts.slice(0, -1).includes(m)),
    last.length === 1 ? last.toUpperCase() : last,
  ].join('+');
};

const SIGNS: Readonly<Record<string, string>> = {
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  CommandOrControl: '⌘',
  Return: '↩',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
};

/** ["⇧", "⌘", "D"] */
export const signs = (accelerator: string): ReadonlyArray<string> =>
  ALONE[accelerator] !== undefined
    ? [ALONE[accelerator]]
    : canonical(accelerator)
        .split('+')
        .map((p) => SIGNS[p] ?? p);
/** "⇧⌘D" */
export const label = (accelerator: string): string => signs(accelerator).join('');

/** The other action that already has those keys. */
export const takenBy = (
  id: HotkeyID,
  accelerator: string,
  changes: HotkeyChanges,
): HotkeyInfo | undefined => {
  const wanted = canonical(accelerator);
  return HOTKEYS.find((k) => k.id !== id && keysOf(k, changes).some((a) => canonical(a) === wanted));
};

// MARK: Recording

const CODES: Readonly<Record<string, string>> = {
  Enter: 'Return',
  NumpadEnter: 'Return',
  Space: 'Space',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

export interface Pressed {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

/** The modifier of a press and release with nothing in between, or why it can't be used. */
export const fromTap = (
  code: string,
): { readonly keys: string } | { readonly problem: string } | undefined => {
  const right = /^(Alt|Control|Shift|Meta)Right$/.exec(code)?.[1];
  if (right) return { keys: right === 'Meta' ? 'RightCommand' : `Right${right}` };
  // The left ones are tapped by accident all the time.
  return /^(Alt|Control|Shift|Meta)Left$/.test(code)
    ? { problem: 'On their own, only the right ⌥, ⌘, ⌃ and ⇧ work' }
    : undefined;
};

/** The accelerator of a key press, or why it can't be one. Undefined while only modifiers are down. */
export const fromPress = (
  e: Pressed,
  mac: boolean,
): { readonly keys: string } | { readonly problem: string } | undefined => {
  const name =
    /^Key([A-Z])$/.exec(e.code)?.[1] ??
    /^Digit(\d)$/.exec(e.code)?.[1] ??
    /^(F(?:[1-9]|1\d|2[0-4]))$/.exec(e.code)?.[1] ??
    CODES[e.code];
  if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(e.code)) return undefined;
  if (name === undefined) return { problem: 'That key can’t be used' };
  const mods = [
    ...(mac && e.ctrlKey ? ['Control'] : []),
    ...(e.altKey ? ['Alt'] : []),
    ...(e.shiftKey ? ['Shift'] : []),
    ...((mac ? e.metaKey : e.ctrlKey) ? ['CommandOrControl'] : []),
  ];
  // Anything else would be taken away from typing, everywhere.
  if (!/^F\d/.test(name) && mods.every((m) => m === 'Shift')) return { problem: 'Add ⌘, ⌥ or ⌃' };
  return { keys: [...mods, name].join('+') };
};
