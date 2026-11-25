// Invisibility, the part without Electron: which panels screen sharing sees. Each has its ghost and starts invisible;
// what it says lasts until Machete quits, even if its window is closed and made again. What has no ghost (the
// screenshots' previews) never stops being invisible.
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
  /** From now on `w` is as visible as the panel `name` is, and its page's ghost knows. Again is harmless. */
  readonly follow: (w: Haunted, name: string) => void;
  readonly invisible: (name: string) => boolean;
  /** Changes the panel whose page is `sender`, only if it's one that follows. */
  readonly toggle: (sender: number) => void;
}

export const makeInvisibility = (): InvisibilityShape => {
  const visible = new Set<string>();
  const windows = new Map<number, { readonly w: Haunted; readonly name: string }>();
  const apply = (w: Haunted, name: string) => {
    if (w.isDestroyed()) return;
    const invisible = !visible.has(name);
    w.setContentProtection(invisible);
    w.webContents.send(Channels.ghostState, invisible);
  };
  return {
    follow: (w, name) => {
      if (w.isDestroyed()) return;
      const { id } = w.webContents;
      if (!windows.has(id)) {
        windows.set(id, { w, name });
        w.once('closed', () => windows.delete(id));
        w.webContents.on('did-finish-load', () => apply(w, name));
      }
      apply(w, name);
    },
    invisible: (name) => !visible.has(name),
    toggle: (sender) => {
      const from = windows.get(sender);
      if (!from) return;
      if (!visible.delete(from.name)) visible.add(from.name);
      for (const { w, name } of windows.values()) if (name === from.name) apply(w, name);
    },
  };
};
