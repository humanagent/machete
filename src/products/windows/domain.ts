// Windows: where the shortcuts put the focused window.
import { Schema } from 'effect';

/** Where ⌃A / ⌃D / ⌃W put the focused window: left half, right half, the whole screen. */
export const WindowSnap = Schema.Literals(['left', 'right', 'maximize']);
export type WindowSnap = typeof WindowSnap.Type;
