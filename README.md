# Machete

A minimal, translucent overlay that sees your screen, listens to your conversation, and answers using **your ChatGPT plan** via [Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart). Built with Electron; macOS today, Windows next.

## Features
- **Plain-text answers**: short, direct text you can read at a glance, with code rendered as a code block when needed.
- **Bots**: switchable profiles (General, Coding, System Design, Behavioral, Recruiter Screen, Sales), each with an editable system prompt and context. Drop a resume or job description (PDF, Word, TXT, Markdown) into a bot's context.
- **System design framework**: the System Design bot follows Requirements → Core Entities → API → Data Flow → High-Level Design → Deep Dives.
- **Follow mode**: watches the screen and the conversation and only speaks up when you make a mistake, without reopening a hidden panel.
- **Recording**: on-device transcription of your mic ("Me") and system audio ("Them"); the transcript is sent as context with every question. Optional auto-answer when the other side asks a question.
- **Uses your ChatGPT subscription**: Sign in with ChatGPT (OAuth with PKCE, loopback redirect), streaming Responses API requests billed to your Plus/Pro plan. Signing in is required.
- **Private overlay**: always starts hidden from screenshots and screen shares; the eye shows it for the current session. No Dock icon, resizable by dragging its edges.

## Shortcuts
| Keys | Action |
|---|---|
| ⌥↩ | Ask about the screen |
| ⌥S | What should I say? |
| ⌥Space | Type a question |
| ⌥M | Start / stop recording |
| ⌘[ or ⌥\ | Show / hide |
| ⌥R | New chat |

## Run
Requires macOS 14+, Xcode command-line tools and Node 20+.

```sh
npm install
npm start          # builds the macOS helper, exports icons, launches Electron
npm test           # unit tests
npm run pack       # dist/mac-arm64/Machete.app
npm run dist       # DMG
```

Grant **Screen & System Audio Recording**, **Microphone** and **Speech Recognition** to Machete (or to your terminal when running `npm start`).

## Architecture
- `src/main/`: app state (`state.js`: ask, follow mode, auto-answer, listening, timeouts), overlay panel (`overlay.js`: non-activating panel, status-bar level, all Spaces, content protection, top-center on the built-in display), menu bar (`tray.js`), global hotkeys (`hotkeys.js`), Sign in with ChatGPT (`auth.js`), Responses API (`responses.js`), bots (`profiles.js`, `manage.js`).
- `src/renderer/`: the overlay and the Bots window.
- `src/shared/strings.js`: prompts, default bots and presets.
- `native/` → `machete-native`: a small Swift helper for what needs Apple frameworks: screen capture excluding Machete's windows (ScreenCaptureKit), transcription (SpeechAnalyzer / SFSpeechRecognizer, mic + system audio) and text extraction (PDFKit). It talks JSON lines over stdin/stdout.
- Data: `~/Library/Application Support/Machete/` (`profiles.json`, `siwc.json`, `settings.json`; Chromium's data in `electron/`). Logs: `~/Library/Logs/Machete.log`. Settings from the earlier native Machete build are imported on first run.

## Windows (next)
Everything in `src/` is cross-platform except what `machete-native` provides:
- Screen capture: `desktopCapturer`, excluding Machete's windows (content protection already hides them).
- Hidden from screen share: `setContentProtection(true)` maps to `WDA_EXCLUDEFROMCAPTURE`.
- Transcription: whisper.cpp (on-device) or a cloud model, microphone + WASAPI loopback for system audio.
- Context files: a PDF/Word parser in JS.
- Icons: SF Symbols can't ship on Windows; swap `assets/icons` for an equivalent set.
- Hotkeys already map ⌥ to Alt and ⌘ to Ctrl.
