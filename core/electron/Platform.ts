// Small Electron capabilities the services use: the browser and the clipboard.
import { clipboard, ClipboardItem, shell } from 'electron';
import { Context, Effect, Layer } from 'effect';
import { ExternalBrowser } from '../services/ExternalBrowser';

export const ExternalBrowserLive = Layer.succeed(ExternalBrowser, {
  open: (url) =>
    Effect.tryPromise(() => shell.openExternal(url)).pipe(
      Effect.catch(() => Effect.logWarning('could not open the browser')),
    ),
});

export class Clipboard extends Context.Service<
  Clipboard,
  {
    readonly write: (text: string) => Effect.Effect<void>;
    /** False when macOS didn't take it. */
    readonly writeImage: (png: Uint8Array) => Effect.Effect<boolean>;
  }
>()('machete/Clipboard') {
  static readonly layer = Layer.succeed(Clipboard, {
    write: (text) => Effect.sync(() => clipboard.writeText(text)),
    writeImage: (png) =>
      Effect.tryPromise(() =>
        clipboard.write([
          new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) }),
        ]),
      ).pipe(
        Effect.as(true),
        Effect.catch((e) => Effect.logWarning(`clipboard: ${String(e)}`).pipe(Effect.as(false))),
      ),
  });
}
