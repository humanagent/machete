// A hidden window keeps its whole process. After a while without being seen it goes, and it's made again the next time.
import type { BrowserWindow } from 'electron';

const resting = new WeakMap<BrowserWindow, () => void>();

/** Destroys `w` once it has been hidden for `ms`. Hide it with `hideWindow`. */
export const releaseWhenIdle = (w: BrowserWindow, ms: number): void => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stay = () => clearTimeout(timer);
  const rest = () => {
    clearTimeout(timer);
    timer = setTimeout(() => w.isDestroyed() || w.isVisible() || w.destroy(), ms);
  };
  w.on('show', stay);
  w.on('hide', rest);
  w.on('closed', stay);
  resting.set(w, rest);
};

/** macOS doesn't always tell when a window hides (one hidden as soon as it shows, or that never did): the wait starts
 * here, not on its event. */
export const hideWindow = (w: BrowserWindow): void => {
  if (w.isDestroyed()) return;
  w.hide();
  resting.get(w)?.();
};
