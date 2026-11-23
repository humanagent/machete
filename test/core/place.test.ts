import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Area, draggedTo, place, type Point, type Size, type Spot } from '../../core/place';

const placePanel = (size: Size, area: Area, keep?: Point) => place('center', size, area, keep);
const size = { width: 800, height: 520 };
const laptop = { x: 0, y: 25, width: 1512, height: 920 };
const left = { x: -1920, y: 0, width: 1920, height: 1080 };

describe('where a panel opens', () => {
  test('centered on the screen you’re on, also on one to the left', () => {
    expect(placePanel(size, laptop)).toEqual({ x: 356, y: 165, ...size });
    expect(placePanel(size, left)).toEqual({ x: -1360, y: 196, ...size });
  });

  test('where it was dragged, on that screen', () => {
    expect(placePanel(size, laptop, { x: 40, y: 60 })).toEqual({ x: 40, y: 60, ...size });
  });

  test('dragged on another screen (or one that was unplugged): centered on this one', () => {
    expect(placePanel(size, laptop, { x: -1500, y: 60 })).toEqual(placePanel(size, laptop));
    expect(placePanel(size, left, { x: 9000, y: 60 })).toEqual(placePanel(size, left));
  });

  test('our own placing isn’t a drag', () => {
    const ours = placePanel(size, laptop);
    expect(draggedTo(ours, ours)).toBeUndefined();
    expect(draggedTo({ x: 10, y: 20 }, ours)).toEqual({ x: 10, y: 20 });
  });

  test('what was dragged before is kept when we place it again', () => {
    const ours = placePanel(size, left);
    expect(draggedTo(ours, ours, { x: 40, y: 60 })).toEqual({ x: 40, y: 60 });
  });

  test('opening on one screen and then on the other follows you', () => {
    const first = placePanel(size, laptop);
    const dragged = draggedTo(first, first);
    expect(placePanel(size, left, dragged)).toEqual(placePanel(size, left));
  });

  test('every spot is on the screen it’s given, wherever that is', () => {
    const spots: ReadonlyArray<Spot> = ['center', 'top', 'bottom', 'bottomLeft'];
    for (const area of [laptop, left, { x: 300, y: -1440, width: 2560, height: 1440 }])
      for (const spot of spots) {
        const at = place(spot, size, area);
        expect(at.x).toBeGreaterThanOrEqual(area.x);
        expect(at.y).toBeGreaterThanOrEqual(area.y);
        expect(at.x + at.width).toBeLessThanOrEqual(area.x + area.width);
        expect(at.y + at.height).toBeLessThanOrEqual(area.y + area.height);
      }
  });

  test('top, bottom and bottom left', () => {
    expect(place('top', { width: 656, height: 74 }, laptop)).toMatchObject({ x: 428, y: 155 });
    expect(place('bottom', { width: 300, height: 70 }, laptop)).toMatchObject({ x: 606, y: 847 });
    expect(place('bottomLeft', { width: 252, height: 182 }, left)).toMatchObject({ x: -1920, y: 898 });
  });
});

test('there’s one source for the screen you’re on', () => {
  const base = join(import.meta.dir, '../..');
  for (const f of new Bun.Glob('{apps,core}/**/*.ts').scanSync(base)) {
    if (f === 'core/electron/ActiveScreen.ts') continue;
    const code = readFileSync(join(base, f), 'utf8');
    expect(code).not.toMatch(/getCursorScreenPoint|getDisplayNearestPoint|getPrimaryDisplay|\.center\(\)/);
  }
});
