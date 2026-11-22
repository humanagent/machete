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

| Keys          | Action                         |
| ------------- | ------------------------------ |
| ⌥↩            | Ask about the screen           |
| ⌥S            | What should I say?             |
| ⌥Space        | Type a question                |
| ⌥M            | Start / stop recording         |
| ⌘[ or ⌥\      | Show / hide                    |
| ⌥R            | New chat                       |
| right ⌘ or ⌥D | Dictate into the app you're in |

## Develop

Requires macOS 14+, Xcode command-line tools and [Bun](https://bun.com) 1.4+. Bun is the whole toolchain: package manager, bundler, type checker, formatter and test runner.

```sh
bun install
bun start              # builds the macOS helper and the app, launches Electron
bun run lint           # bun check (strict TypeScript) + bun fmt --check
bun run format         # bun fmt
bun test               # unit and integration tests
bun test --coverage    # with the coverage report (thresholds in bunfig.toml)
bun run pack           # dist/mac-arm64/Machete.app
bun run dist           # DMG
```

Grant **Screen & System Audio Recording**, **Microphone**, **Speech Recognition** and, for dictation, **Accessibility** to Machete (or to your terminal when running `bun start`).

## Architecture

100% TypeScript on [Effect](https://effect.website): every service is a `Context.Service` built by a `Layer`, every failure is a typed error, every value that crosses a boundary (disk, IPC, the helper) is a `Schema`.

```
src/
  shared/      pure code used everywhere
    domain.ts      schemas of the model (exchanges, transcript, bots, the overlay state)
    ipc.ts         the IPC contract: Schema.TaggedUnion commands and replies per window
    logic.ts       prompt building, follow-mode silence, question detection
    markdown.ts    answer text → HTML
    strings.ts     prompts, default bots, presets
  main/        the Electron main process: one Effect program from app-ready to quit
    services/      the app, independent of Electron (unit tested)
      AppState       the state machine: SubscriptionRef state; asks, Follow and auto-answer as fibers
      ChatGpt        Responses API over effect/http, streamed with Stream
      Auth           Sign in with ChatGPT: PKCE, loopback redirect, token refresh (single-flight)
      NativeHelper   the macOS helper over effect/process: JSON-lines protocol, events on a PubSub
      Dictation      speak → typed into the focused app (talks to the pill through a port)
      Settings, ProfileStore, ContextFiles, FileLogger, AppPaths
    electron/      adapters: overlay, Bots window, dictation pill, menu bar, shortcuts
    main.ts        the layer graph and Electron's lifecycle (quit interrupts the program, finalizers run)
  preload/     typed contextBridge APIs (no Effect, a few hundred bytes each)
  renderer/    one Effect program per window: state stream in, typed commands out
native/        machete-native, Swift: ScreenCaptureKit, SpeechAnalyzer, PDFKit, the right-⌘ tap
scripts/       build.ts (Bun.build) and native.ts (Bun Shell)
test/          bun test: pure logic, every service with fakes or temp folders, the real helper, the bundle
```

Data lives in `~/Library/Application Support/Machete/` (`profiles.json`, `siwc.json`, `settings.json`; Chromium's data in `electron/`). Logs go to `~/Library/Logs/Machete.log` (diagnostics only, never audio or transcript text).

## Windows (next)

Everything in `src/` is cross-platform except what `machete-native` provides:

- Screen capture: `desktopCapturer`, excluding Machete's windows (content protection already hides them).
- Hidden from screen share: `setContentProtection(true)` maps to `WDA_EXCLUDEFROMCAPTURE`.
- Transcription: whisper.cpp (on-device) or a cloud model, microphone + WASAPI loopback for system audio.
- Context files: a PDF/Word parser.
- Icons: SF Symbols can't ship on Windows; swap `assets/icons` for an equivalent set.
- Hotkeys already map ⌥ to Alt and ⌘ to Ctrl.
