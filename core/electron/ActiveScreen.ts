// The screen you're on, for every window of Machete: the one with the pointer. Nothing else asks Electron for it.
import { type BrowserWindow, screen } from 'electron';
import { place, type Point, type Size, type Spot } from '../place';

export const activeScreen = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

/** Puts a window on the screen you're on; left where it is (`keep`) if that's already there. Returns where. */
export const placeOnActive = (w: BrowserWindow, spot: Spot, size: Size, keep?: Point) => {
  const at = place(spot, size, activeScreen().workArea, keep);
  const now = w.getBounds();
  if (now.x !== at.x || now.y !== at.y || now.width !== at.width || now.height !== at.height) w.setBounds(at);
  return at;
};
