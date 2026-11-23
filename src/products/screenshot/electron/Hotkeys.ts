// Screenshots: ⇧⌘3 the screen with the pointer, ⇧⌘4 an area (or, with Space, a window).
import { Effect } from 'effect';
import { hotkeys } from '../../../core/electron/Hotkeys';
import { ScreenshotPreviews } from './PreviewsWindow';

export const ScreenshotHotkeysLive = hotkeys(
  Effect.gen(function* () {
    const previews = yield* ScreenshotPreviews;
    return [
      ['Shift+CommandOrControl+3', previews.full],
      ['Shift+CommandOrControl+4', previews.area],
    ] as const;
  }),
);
