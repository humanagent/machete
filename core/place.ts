// Where a window goes: always on the screen you're on.

export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Size {
  readonly width: number;
  readonly height: number;
}
export type Area = Point & Size;

const inside = (at: Point, size: Size, area: Area) => {
  const x = at.x + size.width / 2;
  const y = at.y + size.height / 2;
  return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
};

/** Which part of the screen it goes to. */
export type Spot = 'center' | 'top' | 'bottom' | 'bottomLeft';
/** Away from the edge. At the top, below a browser's tabs, address and bookmarks. */
const EDGE = { top: 130, bottom: 28 };

/** At its spot on this screen; or where it was (`keep`), if that's on this screen too. */
export const place = (spot: Spot, size: Size, area: Area, keep?: Point): Area => {
  const { width, height } = size;
  if (keep && inside(keep, size, area)) return { x: keep.x, y: keep.y, width, height };
  const middle = Math.round(area.x + (area.width - width) / 2);
  const end = area.y + area.height - height;
  switch (spot) {
    case 'center':
      // A little high.
      return { x: middle, y: Math.round(area.y + Math.max(0, (area.height - height) * 0.35)), width, height };
    case 'top':
      return { x: middle, y: area.y + EDGE.top, width, height };
    case 'bottom':
      return { x: middle, y: Math.round(end - EDGE.bottom), width, height };
    case 'bottomLeft':
      return { x: area.x, y: end, width, height };
  }
};

/** macOS says "moved" for our own placing too; only a place that isn't ours was dragged to. */
export const draggedTo = (now: Point, ours: Point | undefined, before?: Point): Point | undefined =>
  ours && now.x === ours.x && now.y === ours.y ? before : { x: now.x, y: now.y };
