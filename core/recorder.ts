// Recording a shortcut, as a plain state machine: what the Settings window does with each key while it listens.
import { fromPress, fromTap, type HotkeyID, type Pressed } from './hotkeys';

export interface Recorder {
  /** The shortcut being recorded, if any. */
  readonly id?: HotkeyID;
  /** Why the last press couldn't be used. */
  readonly problem: string;
  /** The modifier pressed with nothing else so far. */
  readonly alone?: string;
}
export const IDLE: Recorder = { problem: '' };
export const startRecording = (id: HotkeyID): Recorder => ({ id, problem: '' });

export interface Step {
  readonly next: Recorder;
  /** The keys it ended with. */
  readonly keys?: string;
}
const refuse = (r: Recorder, problem: string): Step => ({ next: r.id ? { id: r.id, problem } : IDLE });
const end = (r: Recorder, result: { readonly keys: string } | { readonly problem: string }): Step =>
  'problem' in result ? refuse(r, result.problem) : { next: IDLE, keys: result.keys };

const modifiers = (e: Pressed) => [e.metaKey, e.ctrlKey, e.altKey, e.shiftKey].filter(Boolean).length;

export const press = (r: Recorder, e: Pressed, mac: boolean): Step => {
  if (r.id === undefined) return { next: r };
  if (e.code === 'Escape' && modifiers(e) === 0) return { next: IDLE };
  const result = fromPress(e, mac);
  if (result !== undefined) return end(r, result);
  // A modifier: it may be the start of a combination, or be used on its own.
  return {
    next: { id: r.id, problem: r.problem, ...(modifiers(e) === 1 ? { alone: e.code } : {}) },
  };
};

export const release = (r: Recorder, code: string): Step => {
  if (r.id === undefined || r.alone !== code) return { next: r };
  const result = fromTap(code);
  return result === undefined ? { next: { id: r.id, problem: r.problem } } : end(r, result);
};
