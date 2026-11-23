// What Calculator does in Machete: its shortcuts and settings.
import { Effect } from 'effect';
import { runApp } from '../../../core/electron/Apps';
import { calculator } from '../app';
import { CalculatorWindow } from './CalculatorWindow';

export const CalculatorApp = runApp(
  calculator,
  Effect.gen(function* () {
    const window = yield* CalculatorWindow;
    return { shortcuts: { toggle: window.toggle } };
  }),
);
