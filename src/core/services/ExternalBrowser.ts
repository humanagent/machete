// Opens a URL in the user's browser. The Electron layer uses shell.openExternal.
import { Context, type Effect } from 'effect';

export class ExternalBrowser extends Context.Service<
  ExternalBrowser,
  { readonly open: (url: string) => Effect.Effect<void> }
>()('machete/ExternalBrowser') {}
