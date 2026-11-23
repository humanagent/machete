// What Screenshots does in Machete: its shortcuts and settings.
import { Effect } from 'effect';
import { runApp } from '../../../core/electron/Apps';
import { screenshot } from '../app';
import { BACKGROUNDS, type Frame, SIZES } from '../frame';
import { Screenshots } from '../services/Screenshots';
import { ScreenshotPreviews } from './PreviewsWindow';

export const ScreenshotApp = runApp(
  screenshot,
  Effect.gen(function* () {
    const previews = yield* ScreenshotPreviews;
    const screenshots = yield* Screenshots;
    const change = (patch: Partial<Frame>) =>
      screenshots.frame.pipe(Effect.flatMap((frame) => screenshots.setFrame({ ...frame, ...patch })));
    return {
      shortcuts: { full: previews.full, area: previews.area },
      settings: {
        frame: {
          get: Effect.map(screenshots.frame, (f) => ({ value: f.on })),
          set: (on) => change({ on: on === true }),
        },
        background: {
          get: Effect.map(screenshots.frame, (f) => ({ value: f.background })),
          set: (value) => {
            const background = BACKGROUNDS.find((b) => b === value);
            return background ? change({ background }) : Effect.void;
          },
        },
        size: {
          get: Effect.map(screenshots.frame, (f) => ({ value: f.size })),
          set: (value) => {
            const size = SIZES.find((z) => z === value);
            return size ? change({ size }) : Effect.void;
          },
        },
      },
    };
  }),
);
