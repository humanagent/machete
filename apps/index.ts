// Every mini app, in the order of the menu. `bun run new-app` adds its line here.
import type { AppManifest } from '../core/app';
import { calculator } from './calculator/app';
import { clipboard } from './clipboard/app';
import { copilot } from './copilot/app';
import { dictation } from './dictation/app';
import { rewrite } from './rewrite/app';
import { screenshot } from './screenshot/app';
import { snippets } from './snippets/app';
import { windows } from './windows/app';

export const APPS: ReadonlyArray<AppManifest> = [
  copilot,
  dictation,
  rewrite,
  windows,
  clipboard,
  screenshot,
  snippets,
  calculator,
];
