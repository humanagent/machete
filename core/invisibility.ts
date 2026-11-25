// Invisibility, the part without Electron: one state for all of Machete, and the windows that follow it. It always
// starts invisible. What has no ghost (the screenshots' previews) never stops being it.
import { Channels } from './channels';

/** What a page gets as `window.ghost`. */
export interface GhostBridge {
  readonly onState: (listener: (invisible: boolean) => void) => () => void;
  readonly toggle: () => void;
}

/** What's needed of a BrowserWindow. */
export interface Haunted {
  readonly isDestroyed: () => boolean;
  readonly setContentProtection: (on: boolean) => void;
  readonly once: (event: 'closed', listener: () => void) => unknown;
  readonly webContents: {
    readonly id: number;
    readonly send: (channel: string, invisible: boolean) => void;
    readonly on: (event: 'did-finish-load', listener: () => void) => unknown;
  };
}

export interface InvisibilityShape {
  /** From now on `w` is as visible as Machete is, and its page's ghost knows. Again is harmless. */
  readonly follow: (w: Haunted) => void;
  readonly invisible: () => boolean;
  /** For the page `sender`, only if it's one that follows. */
  readonly toggle: (sender: number) => void;
}

export const makeInvisibility = (): InvisibilityShape => {
  let invisible = true;
  const windows = new Map<number, Haunted>();
  const apply = (w: Haunted) => {
    if (w.isDestroyed()) return;
    w.setContentProtection(invisible);
    w.webContents.send(Channels.ghostState, invisible);
  };
  return {
    follow: (w) => {
      if (w.isDestroyed()) return;
      const { id } = w.webContents;
      if (!windows.has(id)) {
        windows.set(id, w);
        w.once('closed', () => windows.delete(id));
        w.webContents.on('did-finish-load', () => apply(w));
      }
      apply(w);
    },
    invisible: () => invisible,
    toggle: (sender) => {
      if (!windows.has(sender)) return;
      invisible = !invisible;
      for (const w of windows.values()) apply(w);
    },
  };
};
