// What a mini app is: a manifest (pure data, read by the main process, the Settings page and the build) and, in its
// electron/index.ts, what it does. CONTRIBUTING.md walks through it.

export interface Shortcut {
  /** Unique in the app; "<app>.<name>" everywhere else. */
  readonly name: string;
  readonly title: string;
  /** Default keys: Electron accelerators, or a right-hand modifier on its own ("RightAlt"). */
  readonly keys: ReadonlyArray<string>;
}

interface Field {
  /** Unique in the app; "<app>.<name>" everywhere else. */
  readonly name: string;
  readonly title: string;
  readonly hint?: string;
  /** Shown in the General tab instead of the app's own. */
  readonly general?: boolean;
}
export type Setting =
  | (Field & { readonly kind: 'toggle' })
  /** Without `options` here, the app gives them when it runs. */
  | (Field & {
      readonly kind: 'choice';
      readonly options?: ReadonlyArray<readonly [value: string, name: string]>;
    })
  /** A button. With `confirm`, the first click only asks. */
  | (Field & { readonly kind: 'action'; readonly button: string; readonly confirm?: string });

export interface AppManifest {
  /** Its folder in apps/, in lower case. */
  readonly id: string;
  readonly name: string;
  /** What's inside a 24×24 stroked <svg>. */
  readonly icon: string;
  readonly shortcuts: ReadonlyArray<Shortcut>;
  /** The shortcut its menu line shows. Without one, the line turns the app's shortcuts on and off. */
  readonly menu?: string;
  readonly settings?: ReadonlyArray<Setting>;
  /** Its windows, by name: the folder of each renderer, inside the app. The preload is preload/<name>.ts. */
  readonly windows?: Readonly<Record<string, string>>;
}

export const defineApp = <const M extends AppManifest>(manifest: M): M => manifest;
