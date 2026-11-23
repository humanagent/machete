// Liquid Glass, the part without Electron: when there is any, and where it goes in a window.
import { RADIUS } from './design/tokens';
import type { Size } from './place';

export type GlassSpec =
  /** The whole window, `inset` away from its edges; it grows and shrinks with it. */
  | { readonly _tag: 'Fill'; readonly inset: number; readonly radius: number }
  /** Pieces of it, from its top left corner. */
  | {
      readonly _tag: 'Pieces';
      readonly radius: number;
      readonly pieces: ReadonlyArray<{
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      }>;
    };

export const panelGlass: GlassSpec = { _tag: 'Fill', inset: 0, radius: RADIUS.panel };
export const pillGlass: GlassSpec = { _tag: 'Fill', inset: 0, radius: RADIUS.pill };
/** The Copilot keeps a margin around its panel, for its shadow. */
export const copilotGlass = (inset: number): GlassSpec => ({ _tag: 'Fill', inset, radius: RADIUS.copilot });

/** One under another, the way the previews are stacked. */
export const stackGlass = (card: Size, count: number, gap: number, margin: number): GlassSpec => ({
  _tag: 'Pieces',
  radius: RADIUS.card,
  pieces: Array.from({ length: count }, (_, i) => ({
    x: margin,
    y: margin + i * (card.height + gap),
    ...card,
  })),
});

/** For the addon: x, y, width, height, corner radius and whether it stretches, per piece. */
export const shapes = (spec: GlassSpec, window: Size): ReadonlyArray<number> => {
  switch (spec._tag) {
    case 'Fill': {
      const width = Math.max(0, window.width - spec.inset * 2);
      const height = Math.max(0, window.height - spec.inset * 2);
      return [spec.inset, spec.inset, width, height, spec.radius, 1];
    }
    case 'Pieces':
      return spec.pieces.flatMap((p) => [p.x, p.y, p.width, p.height, spec.radius, 0]);
  }
};

/** NSGlassEffectView is macOS 26's. `version` is process.getSystemVersion(). */
export const hasGlass = (platform: string, version: string): boolean =>
  platform === 'darwin' && Number.parseInt(version, 10) >= 26;

export interface GlassAddon {
  readonly setGlass: (
    handle: Buffer,
    shapes: ReadonlyArray<number>,
    tint: readonly [number, number, number, number],
  ) => boolean;
}

/** The addon, the first time it's asked for; undefined if this Mac has no glass or it doesn't load, and then for good. */
export const loadOnce = (load: () => GlassAddon | undefined): (() => GlassAddon | undefined) => {
  let tried = false;
  let addon: GlassAddon | undefined;
  return () => {
    if (tried) return addon;
    tried = true;
    try {
      const loaded = load();
      if (typeof loaded?.setGlass === 'function') addon = loaded;
    } catch {
      addon = undefined;
    }
    return addon;
  };
};
