# gpt-helper

A minimal, translucent macOS overlay that sees your screen, listens to your conversation, and answers using **your ChatGPT plan** via [Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart).

## Features
- **Plain-text answers**: short, direct text you can read at a glance, with code rendered as a code block when needed.
- **Bots**: switchable profiles (General, Coding, System Design, Behavioral, Recruiter Screen, Sales), each with an editable system prompt and context. Drop a resume or job description (PDF, Word, TXT, Markdown) into a bot's context.
- **System design framework**: the System Design bot follows Requirements → Core Entities → API → Data Flow → High-Level Design → Deep Dives.
- **Follow mode**: watches the screen and the conversation and only speaks up when you make a mistake (something wrong you said, wrote or drew), without reopening a hidden panel.
- **Recording**: on-device transcription (macOS 26 SpeechAnalyzer) of your mic ("Me") and system audio ("Them"); the full transcript shows when you stop and is sent as context with every question. Optional auto-answer when the other side asks a question.
- **Uses your ChatGPT subscription**: Sign in with ChatGPT (OAuth, loopback redirect), streaming Responses API requests billed to your Plus/Pro plan. Falls back to the Codex CLI.
- **Private overlay**: hidden from your own screenshots and screen shares by default (toggle with the eye), no Dock icon, resizable by dragging its edges.

## Shortcuts
| Keys | Action |
|---|---|
| ⌥↩ | Ask about the screen |
| ⌥S | What should I say? |
| ⌥Space | Type a question |
| ⌥M | Start / stop recording |
| ⌘[ or ⌥\ | Show / hide |
| ⌥R | New chat |

## Build
Requires macOS 14+ and Xcode command-line tools.

```sh
./build.sh --install   # builds build/gpt-helper.app, copies it to /Applications and launches it
```

On first use, grant **Screen & System Audio Recording**, **Microphone** and **Speech Recognition** in System Settings ▸ Privacy & Security.

`build.sh` signs with an Apple Development identity if you have one, otherwise with a local self-signed identity named `gpt-helper Local Signing` if present, otherwise ad-hoc. Ad-hoc builds lose macOS permissions on every rebuild.
