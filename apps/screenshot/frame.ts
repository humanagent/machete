// The frame around a screenshot as plain geometry: how much padding, how round, how much shadow.
import { Schema } from 'effect';

export const BACKGROUNDS = ['wallpaper', 'sky', 'sunset', 'graphite', 'white'] as const;
export const SIZES = ['small', 'medium', 'large'] as const;

export const Frame = Schema.Struct({
  on: Schema.Boolean,
  background: Schema.Literals(BACKGROUNDS),
  size: Schema.Literals(SIZES),
});
export type Frame = typeof Frame.Type;

export const DEFAULT_FRAME: Frame = { on: true, background: 'wallpaper', size: 'medium' };

/** Two colors, top-left to bottom-right. The wallpaper has its own picture; these are for when there is none. */
export const COLORS: Readonly<Record<(typeof BACKGROUNDS)[number], readonly [string, string]>> = {
  wallpaper: ['#2f86de', '#9fcdf3'],
  sky: ['#1e82e0', '#9fd0ff'],
  sunset: ['#6d5ce8', '#ff9a62'],
  graphite: ['#3a3f4b', '#15181f'],
  white: ['#ffffff', '#eef0f4'],
};

const PADDING: Readonly<Record<(typeof SIZES)[number], number>> = { small: 0.03, medium: 0.055, large: 0.09 };

export interface FrameLayout {
  readonly width: number;
  readonly height: number;
  readonly padding: number;
  readonly radius: number;
  readonly shadow: number;
}

/** Sizes in the screenshot's own pixels, proportional to it. Without a frame, the screenshot as it is. */
export const layout = (width: number, height: number, frame: Frame): FrameLayout => {
  if (!frame.on) return { width, height, padding: 0, radius: 0, shadow: 0 };
  const padding = Math.max(16, Math.round(Math.max(width, height) * PADDING[frame.size]));
  return {
    width: width + padding * 2,
    height: height + padding * 2,
    padding,
    radius: Math.round(Math.min(36, Math.max(8, Math.min(width, height) * 0.025))),
    shadow: Math.round(padding * 0.6),
  };
};

/** Where to draw a `w`×`h` picture so it covers `width`×`height`, centered. */
export const cover = (w: number, h: number, width: number, height: number) => {
  const scale = Math.max(width / w, height / h);
  return { x: (width - w * scale) / 2, y: (height - h * scale) / 2, width: w * scale, height: h * scale };
};
