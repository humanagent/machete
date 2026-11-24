// What's native inside our own windows: Liquid Glass behind them, and dragging a file out of one. The only place that
// asks for it. Without glass (macOS 14 and 15, or if the addon doesn't load) a window stays as it was made, with its
// vibrancy.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { Effect, Option } from 'effect';
import { GLASS_TINT, glassCss } from '../design/tokens';
import { DRAG, type GlassAddon, type GlassSpec, hasGlass, loadOnce, shapes } from '../glass';
import { appRoot } from './paths';

const NAME = 'machete-glass.node';

const addon = loadOnce(() => {
  if (process.platform !== 'darwin') return undefined;
  // In the packaged app it's next to the helper, signed with it.
  const file = [
    join(process.resourcesPath, '..', 'MacOS', NAME),
    join(appRoot(), 'native', 'bin', NAME),
  ].find((f) => existsSync(f));
  if (!file) return undefined;
  const loaded: { exports: Partial<GlassAddon> } = { exports: {} };
  process.dlopen(loaded, file);
  return loaded.exports as GlassAddon;
});

const styled = new WeakSet<BrowserWindow>();

/** Puts glass behind `w`'s page, or moves the one it has. Call it once its page has loaded. */
export const setGlass = (w: BrowserWindow, spec: GlassSpec): boolean => {
  if (!hasGlass(process.platform, process.getSystemVersion())) return false;
  const native = addon();
  if (!native || w.isDestroyed()) return false;
  try {
    const { width, height } = w.getContentBounds();
    if (!native.setGlass(w.getNativeWindowHandle(), shapes(spec, { width, height }), GLASS_TINT))
      return false;
  } catch {
    return false;
  }
  if (styled.has(w)) return true;
  styled.add(w);
  // Never glass on glass.
  w.setVibrancy(null);
  const style = () => {
    if (!w.isDestroyed()) void w.webContents.insertCSS(glassCss()).catch(() => undefined);
  };
  style();
  w.webContents.on('did-finish-load', style);
  return true;
};

/** Drags `file` out of `w` until it's let go: true if something took it. None if it couldn't be dragged this way. */
export const dragOut = (
  w: BrowserWindow,
  file: string,
  width: number,
): Effect.Effect<Option.Option<boolean>> =>
  Effect.gen(function* () {
    const native = addon();
    if (!native || w.isDestroyed() || !native.drag(w.getNativeWindowHandle(), file, width))
      return Option.none();
    while (native.dragState() === DRAG.dragging) yield* Effect.sleep('50 millis');
    return Option.some(native.dragState() === DRAG.dropped);
  });
