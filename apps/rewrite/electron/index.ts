// What Rewrite does in Machete: its shortcuts and settings.
import { Effect } from 'effect';
import { runApp } from '../../../core/electron/Apps';
import { rewrite } from '../app';
import { Rewrite } from '../services/Rewrite';
import { RewritePanel } from './RewritePanel';

export const RewriteApp = runApp(
  rewrite,
  Effect.gen(function* () {
    const service = yield* Rewrite;
    const panel = yield* RewritePanel;
    return { shortcuts: { fix: service.fix, panel: panel.toggle } };
  }),
);
