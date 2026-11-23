import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { hideWindow, releaseWhenIdle } from '../../core/electron/Idle';

/** A window that, like macOS's sometimes, doesn't say it was hidden. */
class Silent extends EventEmitter {
  visible = true;
  destroyed = false;
  isVisible = () => this.visible;
  isDestroyed = () => this.destroyed;
  hide = () => void (this.visible = false);
  destroy = () => void ((this.destroyed = true), this.emit('closed'));
}
const make = () => {
  const w = new Silent();
  releaseWhenIdle(w as unknown as BrowserWindow, 20);
  return { w, hide: () => hideWindow(w as unknown as BrowserWindow) };
};

test('a hidden window goes even if nothing said it was hidden', async () => {
  const { w, hide } = make();
  hide();
  expect(w.destroyed).toBe(false);
  await Bun.sleep(50);
  expect(w.destroyed).toBe(true);
  hide(); // and hiding one that went is fine
});

test('one that shows again in the meantime stays, until it is hidden for good', async () => {
  const { w, hide } = make();
  hide();
  w.visible = true;
  await Bun.sleep(50);
  expect(w.destroyed).toBe(false);
  hide();
  await Bun.sleep(50);
  expect(w.destroyed).toBe(true);
});
