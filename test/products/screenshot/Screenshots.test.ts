import { chmod, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { Effect, Layer, Option } from 'effect';
import { PermissionsGuide } from '../../../src/core/services/PermissionsGuide';
import { cover, DEFAULT_FRAME, layout } from '../../../src/products/screenshot/frame';
import { captureArgs, fileName, Screenshots } from '../../../src/products/screenshot/services/Screenshots';
import { fakeHelper, filesAt, withTempDir } from '../../support/fakes';

/** Runs `f` with `script` (sh) standing in for screencapture; counts the permission guide's openings. */
const run = <A>(
  script: string,
  f: (s: typeof Screenshots.Service, dir: string) => Effect.Effect<A, unknown>,
  screen: 'granted' | 'denied' = 'granted',
) => {
  let guided = 0;
  return Effect.runPromise(
    withTempDir((dir) =>
      Effect.gen(function* () {
        const exe = join(dir, 'screencapture');
        yield* Effect.promise(() => writeFile(exe, `#!/bin/sh\n${script}\n`).then(() => chmod(exe, 0o755)));
        const helper = yield* fakeHelper({
          permissionStatus: Effect.succeed({
            microphone: 'granted',
            screen,
            accessibility: 'granted',
            inputMonitoring: 'granted',
          }),
        });
        const guide = Layer.succeed(PermissionsGuide, {
          show: Effect.sync(() => void guided++),
          showIfMissing: Effect.void,
        });
        return yield* Effect.scoped(
          Effect.gen(function* () {
            return yield* f(yield* Screenshots, dir);
          }).pipe(
            Effect.provide(
              Screenshots.layerWith(exe).pipe(
                Layer.provide(Layer.mergeAll(filesAt(dir), helper.layer, guide)),
              ),
            ),
          ),
        );
      }),
    ).pipe(Effect.orDie),
  ).then((value) => ({ value, guided }));
};

// The last argument is the file to write.
const WRITES = 'for f; do :; done; printf PNG > "$f"';

test('asks macOS for an area, or for one display', () => {
  expect(captureArgs({ _tag: 'Area' }, 'a.png')).toEqual(['-x', '-o', '-i', '-t', 'png', 'a.png']);
  expect(
    captureArgs({ _tag: 'Full', rect: { x: -1920, y: 0, width: 1920, height: 1080 } }, 'a.png'),
  ).toContain('-R-1920,0,1920,1080');
});

test('names files like macOS does', () => {
  const at = new Date(2026, 10, 3, 9, 5, 7);
  expect(fileName(at)).toBe('Screenshot 2026-11-03 at 09.05.07.png');
  expect(fileName(at, 2)).toBe('Screenshot 2026-11-03 at 09.05.07 (2).png');
});

test('a screenshot can be read, and is gone once discarded', async () => {
  const { value } = await run(WRITES, (s) =>
    Effect.gen(function* () {
      const shot = Option.getOrThrow(yield* s.take({ _tag: 'Area' }));
      const before = yield* s.read(shot);
      yield* s.discard(shot);
      return [Option.map(before, (b) => new TextDecoder().decode(b)), yield* s.read(shot)] as const;
    }),
  );
  expect(value[0]).toEqual(Option.some('PNG'));
  expect(Option.isNone(value[1])).toBe(true);
});

test('Esc leaves nothing and explains nothing', async () => {
  const { value, guided } = await run('exit 1', (s) => s.take({ _tag: 'Area' }));
  expect(Option.isNone(value)).toBe(true);
  expect(guided).toBe(0);
});

test('without Screen Recording the guide opens', async () => {
  const { guided } = await run('exit 1', (s) => s.take({ _tag: 'Area' }), 'denied');
  expect(guided).toBe(1);
});

test('one at a time, and ready again afterwards', async () => {
  const { value } = await run(`sleep 0.3; ${WRITES}`, (s) =>
    Effect.gen(function* () {
      const both = yield* Effect.all([s.take({ _tag: 'Area' }), s.take({ _tag: 'Area' })], {
        concurrency: 'unbounded',
      });
      return [...both, yield* s.take({ _tag: 'Area' })].map(Option.isSome);
    }),
  );
  expect(value).toEqual([true, false, true]);
});

test('saving twice in the same second keeps both', async () => {
  const { value } = await run(WRITES, (s, dir) =>
    Effect.gen(function* () {
      const folder = join(dir, 'desktop');
      yield* Effect.promise(() => Bun.write(join(folder, '.keep'), ''));
      yield* s.save(new Uint8Array([1]), folder);
      yield* s.save(new Uint8Array([2]), folder);
      const missing = yield* s.save(new Uint8Array([3]), join(dir, 'nowhere'));
      return [(yield* Effect.promise(() => readdir(folder))).length, Option.isNone(missing)] as const;
    }),
  );
  expect(value).toEqual([3, true]);
});

test('the frame is remembered', async () => {
  const { value } = await run(WRITES, (s, dir) =>
    Effect.gen(function* () {
      const first = yield* s.frame;
      yield* s.setFrame({ on: false, background: 'sunset', size: 'large' });
      const file = yield* Effect.promise(() => Bun.file(join(dir, 'screenshot.json')).json());
      return [first, yield* s.frame, file] as const;
    }),
  );
  expect(value[0]).toEqual(DEFAULT_FRAME);
  expect(value[1].background).toBe('sunset');
  expect(value[2]).toEqual({ on: false, background: 'sunset', size: 'large' });
});

test('the frame grows with its size and disappears when off', () => {
  const at = (size: 'small' | 'medium' | 'large') => layout(1000, 600, { ...DEFAULT_FRAME, size }).padding;
  expect([at('small'), at('medium'), at('large')]).toEqual([30, 55, 90]);
  expect(layout(1000, 600, DEFAULT_FRAME)).toMatchObject({ width: 1110, height: 710, radius: 15 });
  expect(layout(1000, 600, { ...DEFAULT_FRAME, on: false })).toMatchObject({ width: 1000, padding: 0 });
  expect(layout(40, 20, DEFAULT_FRAME).padding).toBe(16);
});

test('the wallpaper covers the frame without stretching', () => {
  expect(cover(1600, 900, 1000, 1000)).toEqual({
    x: (1000 - 1600 * (1000 / 900)) / 2,
    y: 0,
    width: 1600 * (1000 / 900),
    height: 1000,
  });
});
