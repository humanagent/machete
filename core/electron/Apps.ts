// The running mini apps: what each one gives the menu, the shortcuts and the Settings page.
import { Context, Effect, Layer, Stream, SubscriptionRef } from 'effect';
import type { AppManifest } from '../app';
import type { HotkeyID } from '../hotkeys';
import { Hotkeys } from './Hotkeys';

export interface SettingValue {
  readonly value?: string | boolean;
  readonly hint?: string;
  readonly button?: string;
  readonly options?: ReadonlyArray<readonly [value: string, name: string]>;
}
/** A setting at work. `set` gets the new value; `run` is a button's, and may answer with a line to show. */
export interface SettingControl {
  readonly get: Effect.Effect<SettingValue>;
  readonly set?: (value: string | boolean) => Effect.Effect<unknown>;
  readonly run?: Effect.Effect<unknown>;
  /** Emits when the value changes somewhere else. */
  readonly changes?: Stream.Stream<unknown>;
}
export interface Running {
  readonly open: Effect.Effect<unknown>;
  readonly settings: Readonly<Record<string, SettingControl>>;
}

export class Apps extends Context.Service<
  Apps,
  {
    readonly get: Effect.Effect<ReadonlyMap<string, Running>>;
    readonly changes: Stream.Stream<ReadonlyMap<string, Running>>;
    readonly add: (id: string, running: Running) => Effect.Effect<void>;
    readonly remove: (id: string) => Effect.Effect<void>;
  }
>()('machete/Apps') {
  static readonly layer = Layer.effect(
    Apps,
    Effect.gen(function* () {
      const running = yield* SubscriptionRef.make<ReadonlyMap<string, Running>>(new Map());
      return {
        get: SubscriptionRef.get(running),
        changes: SubscriptionRef.changes(running),
        add: (id, app) => SubscriptionRef.update(running, (m) => new Map(m).set(id, app)),
        remove: (id) =>
          SubscriptionRef.update(running, (m) => {
            const next = new Map(m);
            next.delete(id);
            return next;
          }),
      };
    }),
  );
}

type Names<T extends ReadonlyArray<{ readonly name: string }> | undefined> =
  T extends ReadonlyArray<{ readonly name: infer N extends string }> ? N : never;

export interface AppMain<M extends AppManifest> {
  /** What each shortcut does. */
  readonly shortcuts: Readonly<Record<Names<M['shortcuts']>, Effect.Effect<void>>>;
  /** The setting named in the manifest, at work. */
  readonly settings?: Readonly<Record<Names<M['settings']>, SettingControl>>;
}

/** A mini app's main process side: runs `main` and, for as long as the layer does, has it in Machete. */
export const runApp = <M extends AppManifest, E, R>(manifest: M, main: Effect.Effect<AppMain<M>, E, R>) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const apps = yield* Apps;
      const hotkeys = yield* Hotkeys;
      const { shortcuts, settings } = yield* main;
      const actions = new Map(
        Object.entries<Effect.Effect<void>>(shortcuts).map(
          ([name, action]) => [`${manifest.id}.${name}` as HotkeyID, action] as const,
        ),
      );
      yield* hotkeys.bind(actions);
      yield* apps.add(manifest.id, {
        open:
          manifest.menu === undefined
            ? hotkeys.get.pipe(Effect.flatMap(({ off }) => hotkeys.setOn(manifest.id, off.has(manifest.id))))
            : (actions.get(`${manifest.id}.${manifest.menu}`) ?? Effect.void),
        settings: settings ?? {},
      });
      yield* Effect.addFinalizer(() =>
        hotkeys.unbind([...actions.keys()]).pipe(Effect.andThen(apps.remove(manifest.id))),
      );
    }),
  );
