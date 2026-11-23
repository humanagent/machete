# Contributing

Machete is a menu bar app made of mini apps. Each one lives in its own folder in `apps/`, and anyone can add one. Eight come with it; the ninth can be yours.

## Start

You need macOS 14+, the Xcode command-line tools and [Bun](https://bun.com) 1.4+.

```sh
bun install
bun run new-app color-picker "Color picker"   # a mini app that already works
bun start                                      # it's in the menu bar
```

`new-app` makes `apps/color-picker/` and adds its line to `apps/index.ts` and `apps/main.ts`. From there, change what you want.

## What a mini app is

```
apps/color-picker/
  app.ts             the manifest: name, icon, shortcuts, settings, windows (data only)
  electron/index.ts  what it does: runApp(manifest, …)
  ipc.ts             the messages between its window and the main process, as schemas
  preload/           one small bridge per window
  renderer/          its page: index.html and main.ts
  services/          optional: what it knows and keeps, without Electron, so it can be tested
  package.json       its name and, if it needs them, its own dependencies
```

The rest comes from the manifest. You don't touch the menu, the shortcuts or Settings:

```ts
export const colorPicker = defineApp({
  id: 'color-picker',
  name: 'Color picker',
  icon: '<circle cx="12" cy="12" r="8"/>', // inside a 24×24 stroked <svg>
  shortcuts: [{ name: 'toggle', title: 'Pick a color', keys: ['Alt+Shift+P'] }],
  menu: 'toggle', // the shortcut its menu line runs
  settings: [
    { name: 'hex', title: 'Upper-case hex', kind: 'toggle' },
    {
      name: 'format',
      title: 'Format',
      kind: 'choice',
      options: [
        ['hex', 'Hex'],
        ['rgb', 'RGB'],
      ],
    },
    { name: 'clear', title: 'History', kind: 'action', button: 'Clear', confirm: 'Clear it all?' },
  ],
  windows: { 'color-picker': 'renderer' },
});
```

Machete gives it a tab in Settings with those settings and its shortcuts. Something bigger gets its own panel (`makePanel`) and a button there that opens it, like Copilot's bots.

`runApp` gets what each shortcut and setting does. TypeScript tells you if one is missing:

```ts
export const ColorPickerApp = runApp(
  colorPicker,
  Effect.gen(function* () {
    const panel = yield* makePanel('color-picker', { width: 320, height: 160 });
    return {
      shortcuts: { toggle: … },
      settings: {
        hex: { get: Effect.succeed({ value: true }), set: (on) => … },
        format: { get: …, set: … },
        clear: { get: Effect.succeed({ hint: '12 colors' }), run: Effect.succeed('Cleared') },
      },
    };
  }),
);
```

## What you can use

| From `core/`                | For                                                                        |
| --------------------------- | -------------------------------------------------------------------------- |
| `electron/Panel`            | A window that doesn't take focus from the app you're in                    |
| `services/NativeHelper`     | What needs macOS: pasting, the selected text, capturing, snapping a window |
| `services/JsonFile`         | Files that are checked when read and never half-written                    |
| `services/ChatGpt`          | Asking the person's ChatGPT plan                                           |
| `services/PermissionsGuide` | The window that explains a missing macOS permission                        |

Everything looks the same because it's decided once, in `core/design/`: `tokens.ts` has the colors, sizes and corners, `machete.css` the components (`panel`, `sheet`, `field`, `btn`, `list`…). Link `../machete.css` from your page and use `var(--…)`: a test rejects colors and fonts of your own. Panels float on Liquid Glass (macOS 26) without asking: `makePanel` does it, through `electron/Glass`. Glass is for what floats, never for content (that's a `sheet`) and never on glass; `btn primary` is the only color, one per panel.

If macOS needs something new, add a command to the Swift helper in `native/` and its method in `NativeHelper`.

## The rules

- **Light.** It costs nothing while nobody uses it: windows are made the first time they open, nothing polls.
- **Waits to be called.** Nothing shows when Machete starts.
- **Private.** Panels stay out of screen sharing (`makePanel` does it). Say in the pull request what leaves the Mac, if anything, and send it only when the person asks. Never log what people write.
- **Shortcuts** can't repeat another app's, and shouldn't take one people type with. With `keys: []` it starts without one, and people record theirs in Settings.
- **Only your folder.** One app doesn't import from another. If two need the same thing, it goes in `core/`. (Dictation and Rewrite still read Copilot's state. That debt is ours; don't add to it.)
- **Yours.** Don't copy another product's name, icon or look.

## Before the pull request

```sh
bun fmt && bun run verify
```

It checks types and format and runs the tests. `test/apps.test.ts` already checks every app's manifest; put yours in `test/apps/<id>/` for what it calculates, reads or writes. Files need 85% of their lines and 80% of their functions covered.

In the pull request: what it does in one sentence, its shortcut, the permissions it needs, what leaves the Mac, and a screenshot.

Got an idea but no time? Open an issue with what it replaces and how you'd use it.
