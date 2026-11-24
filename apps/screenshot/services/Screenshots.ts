// Taking screenshots with macOS's own `screencapture` (it brings the crosshair, the size readout, Space to pick
// a window and Esc to cancel). Each one is a PNG in a temporary folder until it is saved, dragged out or closed.
import { Context, Effect, FileSystem, Layer, Option, Path, Ref } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type { Rect } from '../../../core/permissions';
import { AppPaths } from '../../../core/services/AppPaths';
import { readJson, writeJson } from '../../../core/services/JsonFile';
import { NativeHelper } from '../../../core/services/NativeHelper';
import { PermissionsGuide } from '../../../core/services/PermissionsGuide';
import { DEFAULT_FRAME, Frame } from '../frame';

const SCREENCAPTURE = '/usr/sbin/screencapture';

export interface Shot {
  readonly id: string;
  readonly file: string;
}

export type Target =
  { readonly _tag: 'Area' } | { readonly _tag: 'Full'; /** The display, in points. */ readonly rect: Rect };

/** -x no sound, -o no shadow around a window, -i interactive, -R a rectangle (one display). */
export const captureArgs = (target: Target, file: string): ReadonlyArray<string> =>
  target._tag === 'Area'
    ? ['-x', '-o', '-i', '-t', 'png', file]
    : [
        '-x',
        `-R${target.rect.x},${target.rect.y},${target.rect.width},${target.rect.height}`,
        '-t',
        'png',
        file,
      ];

/** "Screenshot 2026-11-23 at 09.05.07.png", like macOS names them. */
export const fileName = (at: Date, n = 1) => {
  const two = (x: number) => String(x).padStart(2, '0');
  const day = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  const time = [at.getHours(), at.getMinutes(), at.getSeconds()].map(two).join('.');
  return `Screenshot ${day} at ${time}${n > 1 ? ` (${n})` : ''}.png`;
};

export interface ScreenshotsShape {
  /** None: cancelled, one is already being taken, or macOS didn't allow it (the guide opens then). */
  readonly take: (target: Target) => Effect.Effect<Option.Option<Shot>>;
  readonly read: (shot: Shot) => Effect.Effect<Option.Option<Uint8Array>>;
  /** Another file with the same picture. */
  readonly duplicate: (shot: Shot) => Effect.Effect<Option.Option<Shot>>;
  readonly discard: (shot: Shot) => Effect.Effect<void>;
  /** Writes `png` in `folder` without replacing anything; returns the file, or None if it couldn't. */
  readonly save: (png: Uint8Array, folder: string) => Effect.Effect<Option.Option<string>>;
  readonly frame: Effect.Effect<Frame>;
  readonly setFrame: (frame: Frame) => Effect.Effect<void>;
}

export class Screenshots extends Context.Service<Screenshots, ScreenshotsShape>()('machete/Screenshots') {
  static readonly layerWith = (exe: string) =>
    Layer.effect(
      Screenshots,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const helper = yield* NativeHelper;
        const guide = yield* PermissionsGuide;
        const { screenshotFile } = yield* AppPaths;
        // Gone when Machete quits.
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: 'machete-shots-' });
        const busy = yield* Ref.make(false);
        const count = yield* Ref.make(0);
        const stored = yield* readJson(Frame, screenshotFile);
        const frame = yield* Ref.make(Option.getOrElse(stored, () => DEFAULT_FRAME));

        const capture = (target: Target) =>
          Effect.gen(function* () {
            const id = String(yield* Ref.updateAndGet(count, (n) => n + 1));
            const folder = path.join(dir, id);
            yield* fs.makeDirectory(folder, { recursive: true });
            const file = path.join(folder, fileName(new Date()));
            yield* Effect.scoped(
              spawner
                .spawn(ChildProcess.make(exe, [...captureArgs(target, file)]))
                .pipe(Effect.flatMap((p) => p.exitCode)),
            );
            if (yield* fs.exists(file)) return Option.some<Shot>({ id, file });
            yield* fs.remove(folder, { recursive: true });
            // Esc, or no Screen Recording permission: only then is there something to explain.
            const allowed = yield* helper.permissionStatus.pipe(
              Effect.map((p) => p.screen === 'granted'),
              Effect.orElseSucceed(() => true),
            );
            if (!allowed) yield* guide.show;
            return Option.none<Shot>();
          }).pipe(
            Effect.catch((e) =>
              Effect.logWarning(`screenshot: ${String(e)}`).pipe(Effect.as(Option.none<Shot>())),
            ),
          );

        return {
          take: (target) =>
            Ref.getAndSet(busy, true).pipe(
              Effect.flatMap((was) =>
                was ? Effect.succeedNone : capture(target).pipe(Effect.ensuring(Ref.set(busy, false))),
              ),
            ),
          read: (shot) => fs.readFile(shot.file).pipe(Effect.option),
          duplicate: (shot) =>
            Effect.gen(function* () {
              const id = String(yield* Ref.updateAndGet(count, (n) => n + 1));
              const folder = path.join(dir, id);
              yield* fs.makeDirectory(folder, { recursive: true });
              const file = path.join(folder, path.basename(shot.file));
              yield* fs.copyFile(shot.file, file);
              return Option.some<Shot>({ id, file });
            }).pipe(
              Effect.catch((e) =>
                Effect.logWarning(`screenshot: ${String(e)}`).pipe(Effect.as(Option.none<Shot>())),
              ),
            ),
          discard: (shot) => fs.remove(path.dirname(shot.file), { recursive: true }).pipe(Effect.ignore),
          save: (png, folder) =>
            Effect.gen(function* () {
              const now = new Date();
              let n = 1;
              while (yield* fs.exists(path.join(folder, fileName(now, n)))) n++;
              const file = path.join(folder, fileName(now, n));
              yield* fs.writeFile(file, png);
              return Option.some(file);
            }).pipe(
              Effect.catch((e) =>
                Effect.logWarning(`screenshot: ${String(e)}`).pipe(Effect.as(Option.none<string>())),
              ),
            ),
          frame: Ref.get(frame),
          setFrame: (next) =>
            Ref.set(frame, next).pipe(
              Effect.andThen(writeJson(Frame, screenshotFile, next)),
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
              Effect.catch((e) => Effect.logWarning(`screenshot: ${e.message}`)),
            ),
        } satisfies ScreenshotsShape;
      }),
    );

  static readonly layer = Screenshots.layerWith(SCREENCAPTURE);
}
