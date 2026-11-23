// What every mini app does when Machete runs. `bun run new-app` adds its line here.
import { Layer } from 'effect';
import { CalculatorApp } from './calculator/electron';
import { ClipboardApp } from './clipboard/electron';
import { CopilotApp } from './copilot/electron';
import { DictationApp } from './dictation/electron';
import { RewriteApp } from './rewrite/electron';
import { ScreenshotApp } from './screenshot/electron';
import { SnippetsApp } from './snippets/electron';
import { WindowsApp } from './windows/electron';

export const AppsLive = Layer.mergeAll(
  CopilotApp,
  DictationApp,
  RewriteApp,
  WindowsApp,
  ClipboardApp,
  ScreenshotApp,
  SnippetsApp,
  CalculatorApp,
);
