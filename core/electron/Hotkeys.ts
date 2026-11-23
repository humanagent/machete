// Global shortcuts. Each app binds what its actions do; the keys are the manifest's or the ones recorded in Settings,
// and change while Machete runs.
import { globalShortcut } from 'electron';
import { Context, Effect, Layer, Ref, Stream, SubscriptionRef } from 'effect';
import { HOTKEYS, type HotkeyID, type HotkeyInfo, isAlone, keysOf, takenBy } from '../hotkeys';
import { ModifierTaps } from '../services/ModifierTaps';
import { Settings } from '../services/Settings';
import { makeRunner } from './Runner';

export interface HotkeysState {
  readonly keys: ReadonlyMap<HotkeyID, ReadonlyArray<string>>;
  /** Actions with a key macOS (or another app) didn't give us. */
  readonly failed: ReadonlySet<HotkeyID>;
  /** Apps whose shortcuts are off. */
  readonly off: ReadonlySet<string>;
}

export interface HotkeysShape {
  readonly get: Effect.Effect<HotkeysState>;
  readonly changes: Stream.Stream<HotkeysState>;
  /** What these actions do, for as long as the caller's layer runs. */
  readonly bind: (actions: ReadonlyMap<HotkeyID, Effect.Effect<void>>) => Effect.Effect<void>;
  readonly unbind: (ids: ReadonlyArray<HotkeyID>) => Effect.Effect<void>;
  /** New keys for an action ([] turns it off). Returns the action that has them already, if any: nothing changes then. */
  readonly set: (id: HotkeyID, keys: ReadonlyArray<string>) => Effect.Effect<HotkeyInfo | undefined>;
  /** Back to its default keys. Returns the action that took one of them meanwhile, if any. */
  readonly reset: (id: HotkeyID) => Effect.Effect<HotkeyInfo | undefined>;
  readonly resetAll: Effect.Effect<void>;
  /** While recording, no shortcut works, so any combination can be pressed. */
  readonly pause: (on: boolean) => Effect.Effect<void>;
  /** An app's shortcuts, on or off. */
  readonly setOn: (app: string, on: boolean) => Effect.Effect<void>;
}

export class Hotkeys extends Context.Service<Hotkeys, HotkeysShape>()('machete/Hotkeys') {
  static readonly layer = Layer.effect(
    Hotkeys,
    Effect.gen(function* () {
      const settings = yield* Settings;
      const modifiers = yield* ModifierTaps;
      const run = yield* makeRunner<never>();
      const actions = new Map<HotkeyID, Effect.Effect<void>>();
      const registered = new Map<HotkeyID, ReadonlyArray<string>>();
      const paused = yield* Ref.make(false);
      const state = yield* SubscriptionRef.make<HotkeysState>({
        keys: new Map(),
        failed: new Set(),
        off: new Set(),
      });
      const failed = new Set<HotkeyID>();

      const release = (id: HotkeyID) => {
        for (const accelerator of registered.get(id) ?? [])
          if (!isAlone(accelerator)) globalShortcut.unregister(accelerator);
        registered.delete(id);
        failed.delete(id);
      };
      const hold = (id: HotkeyID, keys: ReadonlyArray<string>) => {
        const action = actions.get(id);
        if (!action) return;
        const got = keys.filter((accelerator) => {
          if (isAlone(accelerator)) {
            run(modifiers.need);
            return true;
          }
          try {
            return globalShortcut.register(accelerator, () => run(action));
          } catch {
            return false; // not an accelerator (a hand-edited settings.json)
          }
        });
        registered.set(id, got);
        if (got.length < keys.length) {
          failed.add(id);
          run(Effect.logWarning(`hotkeys: failed to register ${id} (${keys.join(', ')})`));
        }
      };
      const apply = Effect.gen(function* () {
        const { hotkeys: changes, off: offApps } = yield* settings.get;
        const resting = yield* Ref.get(paused);
        const off = new Set(offApps);
        for (const { id } of HOTKEYS) release(id);
        const keys = new Map(HOTKEYS.map((k) => [k.id, keysOf(k, changes)] as const));
        if (resting) return;
        for (const k of HOTKEYS) if (!off.has(k.app)) hold(k.id, keys.get(k.id)!);
        yield* SubscriptionRef.set(state, { keys, failed: new Set(failed), off });
      });
      const save = (patch: Parameters<typeof settings.update>[0]) =>
        settings.update(patch).pipe(
          Effect.catch((e) => Effect.logError(e.message)),
          Effect.andThen(apply),
        );
      const taps = yield* modifiers.taps;
      yield* taps.pipe(
        Stream.runForEach((key) =>
          Effect.sync(() => {
            for (const [id, keys] of registered) if (keys.includes(key)) run(actions.get(id) ?? Effect.void);
          }),
        ),
        Effect.forkScoped,
      );
      const info = (id: HotkeyID) => HOTKEYS.find((k) => k.id === id)!;

      yield* Effect.addFinalizer(() => Effect.sync(() => HOTKEYS.forEach(({ id }) => release(id))));

      return {
        get: SubscriptionRef.get(state),
        changes: SubscriptionRef.changes(state),
        bind: (more) =>
          Effect.sync(() => more.forEach((action, id) => actions.set(id, action))).pipe(
            Effect.andThen(apply),
          ),
        unbind: (ids) =>
          Effect.sync(() => {
            for (const id of ids) {
              release(id);
              actions.delete(id);
            }
          }),
        set: (id, keys) =>
          Effect.gen(function* () {
            const { hotkeys: changes } = yield* settings.get;
            const other = keys.map((k) => takenBy(id, k, changes)).find((k) => k !== undefined);
            if (other) return other;
            yield* save({ hotkeys: { ...changes, [id]: keys } });
            return undefined;
          }),
        reset: (id) =>
          Effect.gen(function* () {
            const { hotkeys: changes } = yield* settings.get;
            const { [id]: _, ...rest } = changes;
            const other = info(id)
              .keys.map((k) => takenBy(id, k, rest))
              .find((k) => k !== undefined);
            if (other) return other;
            yield* save({ hotkeys: rest });
            return undefined;
          }),
        resetAll: save({ hotkeys: {} }),
        pause: (on) =>
          Ref.getAndSet(paused, on).pipe(Effect.flatMap((was) => (was === on ? Effect.void : apply))),
        setOn: (app, on) =>
          settings.get.pipe(
            Effect.flatMap(({ off }) =>
              save({ off: [...off.filter((x) => x !== app), ...(on ? [] : [app])] }),
            ),
          ),
      } satisfies HotkeysShape;
    }),
  );
}
