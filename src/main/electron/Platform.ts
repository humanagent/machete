// Small Electron capabilities the services use: the browser and the clipboard.
import { clipboard, shell } from 'electron';
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
  { readonly write: (text: string) => Effect.Effect<void> }
>()('machete/Clipboard') {
  static readonly layer = Layer.succeed(Clipboard, {
    write: (text) => Effect.sync(() => clipboard.writeText(text)),
  });
}
