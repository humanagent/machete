# gpt-helper

A minimal, translucent macOS overlay that sees your screen, listens to your conversation, and answers using **your ChatGPT plan** via [Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart).

## Features
- **Ask about your screen**: captures the display under the mouse and streams the answer.
- **Live transcript**: on-device speech recognition of your mic ("Me") and system audio ("Them").
- **What should I say?**: suggests your next reply from the conversation; optional auto-answer when the other side asks a question.
- **Uses your ChatGPT subscription**: OAuth sign-in, requests billed to your Plus/Pro plan. Falls back to the Codex CLI if you're signed in there instead.
- **Private overlay**: kept out of your own screenshots and screen shares; no Dock icon.

## Shortcuts
| Keys | Action |
|---|---|
| ⌥↩ | Ask about the screen |
| ⌥S | What should I say? |
| ⌥Space | Type a question |
| ⌥M | Start / stop listening |
| ⌘⇧[ or ⌥\ | Show / hide |
| ⌥R | New chat |

## Build
Requires macOS 14+ and Xcode command-line tools.

```sh
./build.sh --install   # builds build/gpt-helper.app, copies it to /Applications and launches it
```

On first use, grant **Screen & System Audio Recording**, **Microphone** and **Speech Recognition** in System Settings ▸ Privacy & Security.

`build.sh` signs with an Apple Development identity if you have one, otherwise with a local self-signed identity named `gpt-helper Local Signing` if present, otherwise ad-hoc. Ad-hoc builds lose macOS permissions on every rebuild.
