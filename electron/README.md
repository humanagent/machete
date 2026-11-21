# Machete (Electron)

Cross-platform rewrite of the native macOS app (`../Sources/Machete`). Same behavior, same prompts, same data,
so the two builds can be swapped on a Mac. Windows support comes next (see the end of this file).

## Run

Requires macOS 14+, Xcode command-line tools and Node 20+.

```sh
cd electron
npm install
npm start          # builds the macOS helper, exports icons, launches Electron
npm test           # unit tests + parity test against the native Swift code
npm run pack       # dist/mac-arm64/Machete.app
npm run dist       # DMG
```

Grant **Screen & System Audio Recording**, **Microphone** and **Speech Recognition** to Machete (or to your
terminal when running `npm start`).

## How it maps to the native app

| Native (Swift) | Electron |
|---|---|
| `AppState.swift` | `src/main/state.js` (same state machine: ask, follow mode, auto-answer, listening, timeouts) |
| `OverlayPanel.swift` | `src/main/overlay.js`: non-activating `panel`, status-bar level, all Spaces, content protection, top-center on the built-in display, top edge pinned |
| `OverlayView.swift`, `AnswerText.swift` | `src/renderer/overlay/` (same sizes, colors, Inter, SF Symbols exported at build time) |
| `AppDelegate.swift` (menu bar, hotkeys) | `src/main/tray.js`, `src/main/hotkeys.js` |
| `SIWC.swift` (Sign in with ChatGPT, Responses API) | `src/main/auth.js`, `src/main/responses.js` |
| `CodexRunner.swift` | `src/main/codex.js` |
| `Profiles.swift` (bots, Manage window) | `src/main/profiles.js`, `src/renderer/manage/`, prompts in `src/shared/strings.js` |
| `ScreenCapture.swift`, `Transcriber.swift`, `AnalyzerStream.swift`, `ContextFiles.swift` | `native/` → `machete-native`, a small Swift helper that reuses that code (ScreenCaptureKit, SpeechAnalyzer, PDFKit) |

- **Prompts** are generated from the Swift sources (`scripts/extract-strings.py`), not retyped.
- **Parity**: `test/parity.test.js` compiles the original `buildPrompt`, `isSilent` and `looksLikeQuestion` from
  `AppState.swift` and checks the JS port returns byte-identical results on hundreds of random inputs.
- **Shared data**: `~/Library/Application Support/Machete/` (`profiles.json`, `siwc.json` in the same format; the token
  file uses Swift's reference-date timestamps). Settings that the native app keeps in UserDefaults are imported on first
  run into `settings.json`. Logs go to `~/Library/Logs/Machete.log`.
- Chromium's own data lives in `~/Library/Application Support/Machete/electron/`.

## Known differences

- The native panel adds a faint system blur (NSVisualEffectView at 25% alpha) under the tint; the Electron panel uses
  the same tints without that blur.
- The legacy `gpt-helper` folder is copied, not moved, so the old build keeps working.

## Windows (next)

Everything in `src/` is cross-platform except what `machete-native` provides. For Windows:
- Screen capture: `desktopCapturer`, excluding Machete's windows (content protection already hides them).
- Hidden from screen share: `setContentProtection(true)` maps to `WDA_EXCLUDEFROMCAPTURE`.
- Transcription: whisper.cpp (on-device) or a cloud model, microphone + WASAPI loopback for system audio.
- Context files: a PDF/Word parser in JS.
- Icons: SF Symbols can't ship on Windows; swap `assets/icons` for an equivalent set.
- Hotkeys already map ⌥ to Alt and ⌘ to Ctrl.
