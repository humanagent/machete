import AppKit
import AVFoundation

// machete-native: the macOS half of the Electron app.
//
//   machete-native serve --exclude-pid <pid>   long-lived; JSON commands on stdin, JSON lines on stdout
//   machete-native extract <file>              prints the file's text (PDF, Word, RTF, HTML, text)
//   machete-native icon <symbol> <pt> <out.png> [scale] [weight]
//
// serve commands (one JSON object per line):
//   {"id":1,"cmd":"capture","max":1440}   -> {"id":1,"ok":true,"dataURL":…}
//   {"id":2,"cmd":"fingerprint"}                                 -> {"id":2,"ok":true,"pixels":[…]}
//   {"id":3,"cmd":"listen.start","locale":"en-US"}               -> {"id":3,"ok":true}; then events
//   {"cmd":"listen.pause","paused":true} / {"cmd":"listen.stop"}
//   {"id":4,"cmd":"dictate.start","locale":"es-AR"} -> {"id":4,"ok":true}; then {"type":"dictation.level","level":0…1}
//   {"id":5,"cmd":"dictate.stop","cancel":false}     -> {"id":5,"ok":true,"text":…} (mic only, no AI)
//   {"id":6,"cmd":"frontmost"}                       -> {"id":6,"ok":true,"name":…,"icon":dataURL}
//   {"id":7,"cmd":"paste","text":…}                  -> {"id":7,"ok":true|false} (types into the focused app)
//   {"id":8,"cmd":"modifiers.watch"}                 -> {"id":8,"ok":true|false}; then {"type":"modifier","key":"RightAlt"|"RightCommand"|"RightControl"|"RightShift"} on each lone tap
//   {"id":9,"cmd":"window.snap","to":"left"|"right"|"maximize"} -> {"id":9,"ok":true|false} (the focused window of the frontmost app)
//   {"id":10,"cmd":"clipboard.watch"}              -> {"id":10,"ok":true}; then {"type":"clipboard","text":…} on each new text copy
//   {"id":12,"cmd":"snippets.set","items":[{"abbreviation":…,"content":…}]} -> {"id":12,"ok":true|false} (false: no Input Monitoring)
//   {"id":13,"cmd":"selection.read"}                -> {"id":13,"ok":true,"text":…,"pid":…} (the text selected in the frontmost app)
//   {"id":14,"cmd":"selection.replace","text":…,"pid":…} -> {"id":14,"ok":true,"pasted":true|false} (false: left on the clipboard)
//   {"id":15,"cmd":"wallpaper"}                        -> {"id":15,"ok":true,"dataURL":…} (the desktop picture of the screen under the pointer)
//   machete-native text-replacements                -> prints the Mac's text replacements as JSON (one-shot)
// events: {"type":"partial"|"commit","speaker":"me"|"them","text":…}, {"type":"error","message":…}, {"type":"log",…}

let args = CommandLine.arguments

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write(Data((msg + "\n").utf8))
    exit(1)
}

switch args.count > 1 ? args[1] : "" {
case "extract":
    guard args.count > 2 else { fail("usage: machete-native extract <file>") }
    guard let text = Extract.text(from: URL(fileURLWithPath: args[2])) else { exit(2) }
    FileHandle.standardOutput.write(Data(text.utf8))
    exit(0)

case "icon":
    guard args.count > 4, let pt = Double(args[3]) else { fail("usage: machete-native icon <symbol> <pt> <out.png> [scale] [weight]") }
    let scale = args.count > 5 ? Double(args[5]) ?? 1 : 1
    let weight = args.count > 6 ? args[6] : "regular"
    do { try SymbolIcon.export(name: args[2], pointSize: pt, scale: scale, weight: weight, to: args[4]) } catch { fail("\(error)") }
    exit(0)

case "transcribe":
    // Same engine as the app, fed from a file: `transcribe <audio> <locale>`. For tests and tuning.
    guard args.count > 3 else { fail("usage: machete-native transcribe <audio> <locale>") }
    let url = URL(fileURLWithPath: args[2])
    let locale = Locale(identifier: args[3])
    Task { @MainActor in
        guard #available(macOS 26.0, *) else { fail("transcribe needs macOS 26") }
        do { print(try await FileTranscription.run(url, locale: locale)); exit(0) } catch { fail("\(error)") }
    }
    dispatchMain()

case "soak":
    // Two live channels fed in real time from a file, like a recording: `soak <audio> <locale> <seconds>`. For tests.
    guard args.count > 4, let seconds = Int(args[4]) else { fail("usage: machete-native soak <audio> <locale> <seconds>") }
    let soakURL = URL(fileURLWithPath: args[2])
    let soakLocale = Locale(identifier: args[3])
    Task { @MainActor in
        guard #available(macOS 26.0, *) else { fail("soak needs macOS 26") }
        do { try await Load.soak(soakURL, locale: soakLocale, seconds: seconds); exit(0) } catch { fail("\(error)") }
    }
    dispatchMain()

case "output-load":
    // Reports that many lines as fast as it can, whether or not anyone reads them. For tests.
    guard args.count > 2, let lines = Int(args[2]) else { fail("usage: machete-native output-load <lines>") }
    Load.output(lines: lines)
    exit(0)

case "permissions":
    // One-shot, so it sees changes made in System Settings while the app runs (a long-lived process caches them).
    let mic = AVCaptureDevice.authorizationStatus(for: .audio)
    let status: [String: Any] = [
        "microphone": mic == .authorized ? "granted" : (mic == .notDetermined ? "not-determined" : "denied"),
        "screen": CGPreflightScreenCaptureAccess() ? "granted" : "denied",
        "inputMonitoring": CGPreflightListenEventAccess() ? "granted" : "denied",
        "accessibility": AXIsProcessTrusted() ? "granted" : "denied",
    ]
    FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: status))
    exit(0)

case "text-replacements":
    guard let items = Snippets.macTextReplacements() else { exit(2) }
    FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: items))
    exit(0)

case "settings-window":
    // Bounds of the frontmost System Settings window (top-left origin, points), so the guide can sit beside it.
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let win = list.first { ($0[kCGWindowOwnerName as String] as? String) == "System Settings" && ($0[kCGWindowLayer as String] as? Int) == 0 }
    guard let b = win?[kCGWindowBounds as String] as? [String: Any] else { exit(2) }
    FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: b))
    exit(0)

case "serve":
    if let i = args.firstIndex(of: "--exclude-pid"), i + 1 < args.count, let pid = pid_t(args[i + 1]) {
        Capture.excludedPIDs.insert(pid)
    }
    // AppKit context for NSScreen / NSEvent.mouseLocation; never shows in the Dock.
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    // The helper shares Machete's bundle identifier, so a "quit Machete" Apple event can land here.
    // It belongs to the app: the helper ends only when Machete closes its stdin.
    let keepAlive = KeepAlive()
    app.delegate = keepAlive
    MainActor.assumeIsolated { Server.shared.run() }
    withExtendedLifetime(keepAlive) { app.run() }

default:
    fail("usage: machete-native serve|extract|icon|transcribe|soak|output-load|permissions|settings-window|text-replacements")
}

@MainActor
final class Server {
    static let shared = Server()
    private var transcriber: Transcriber?
    private var dictation: Transcriber?
    private var dictationText: [String] = []
    private var dictationPartial = ""
    private var lastLevelAt = Date.distantPast

    nonisolated func run() {
        // Read stdin on a background thread; handle each command on the main actor.
        Thread.detachNewThread {
            // This thread lives as long as the app: without a pool per line, what each one autoreleases would never go.
            var more = true
            while more {
                autoreleasepool {
                    guard let line = readLine(strippingNewline: true) else { more = false; return }
                    guard let data = line.data(using: .utf8),
                          let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
                    Task { @MainActor in await Server.shared.handle(obj) }
                }
            }
            // Parent closed stdin (Electron quit): stop cleanly and exit.
            Task { @MainActor in
                await Server.shared.transcriber?.stop()
                Out.flush()
                exit(0)
            }
        }
    }

    private func reply(_ id: Any?, _ fields: [String: Any]) {
        var o = fields
        if let id { o["id"] = id }
        Out.emit(o)
    }

    func handle(_ cmd: [String: Any]) async {
        let id = cmd["id"]
        switch cmd["cmd"] as? String ?? "" {
        case "capture":
            let max = cmd["max"] as? Int ?? 1440
            do {
                reply(id, ["ok": true, "dataURL": try await Capture.dataURL(maxLongSide: max)])
            } catch {
                reply(id, ["ok": false, "error": error.localizedDescription])
            }

        case "fingerprint":
            do { reply(id, ["ok": true, "pixels": try await Capture.fingerprint().map { Int($0) }]) }
            catch { reply(id, ["ok": false, "error": error.localizedDescription]) }

        case "wallpaper":
            do { reply(id, ["ok": true, "dataURL": try await Wallpaper.dataURL()]) }
            catch { reply(id, ["ok": false, "error": error.localizedDescription]) }

        case "listen.start":
            let before = transcriber
            let t = Transcriber(locale: Locale(identifier: cmd["locale"] as? String ?? "en-US"))
            t.onPartial = { speaker, text in Out.emit(["type": "partial", "speaker": speaker.rawValue, "text": text]) }
            t.onCommit = { speaker, text in Out.emit(["type": "commit", "speaker": speaker.rawValue, "text": text]) }
            t.onError = { message in Out.emit(["type": "error", "message": message]) }
            // Before waiting for anything, so a stop that arrives meanwhile finds it.
            transcriber = t
            await before?.stop()
            do {
                try await t.start()
                reply(id, ["ok": true])
            } catch {
                if transcriber === t { transcriber = nil }
                reply(id, ["ok": false, "error": error.localizedDescription])
            }

        case "listen.pause":
            transcriber?.setPaused(cmd["paused"] as? Bool ?? true)
            reply(id, ["ok": true])

        case "listen.stop":
            let t = transcriber
            transcriber = nil
            await t?.stop()
            reply(id, ["ok": true])
            Out.emit(["type": "stopped"])

        case "permissions":
            let mic = AVCaptureDevice.authorizationStatus(for: .audio)
            reply(id, ["ok": true, "microphone": mic == .authorized ? "granted" : (mic == .notDetermined ? "not-determined" : "denied"),
                       "screen": CGPreflightScreenCaptureAccess() ? "granted" : "denied",
                       "inputMonitoring": CGPreflightListenEventAccess() ? "granted" : "denied",
                       "accessibility": Dictation.canType(prompt: false) ? "granted" : "denied"])

        case "dictate.start":
            let before = dictation
            let d = Transcriber(locale: Locale(identifier: cmd["locale"] as? String ?? "en-US"), includeSystem: false)
            d.onPartial = { [weak self] _, text in self?.dictationPartial = text }
            d.onCommit = { [weak self] _, text in self?.dictationText.append(text); self?.dictationPartial = "" }
            d.onError = { message in Out.emit(["type": "dictation.error", "message": message]) }
            d.onLevel = { [weak self] level in
                Task { @MainActor in
                    guard let self, Date().timeIntervalSince(self.lastLevelAt) > 0.06 else { return }
                    self.lastLevelAt = Date()
                    Out.emit(["type": "dictation.level", "level": level])
                }
            }
            dictation = d
            await before?.stop()
            dictationText = []; dictationPartial = ""
            do { try await d.start(); reply(id, ["ok": true]) } catch {
                if dictation === d { dictation = nil }
                reply(id, ["ok": false, "error": error.localizedDescription])
            }

        case "dictate.stop":
            let d = dictation
            dictation = nil
            await d?.stop() // waits for the last words
            var parts = dictationText
            if !dictationPartial.isEmpty { parts.append(dictationPartial) }
            dictationText = []; dictationPartial = ""
            let text = (cmd["cancel"] as? Bool ?? false) ? "" : parts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
            reply(id, ["ok": true, "text": text])

        case "frontmost":
            var r = Dictation.frontmost(); r["ok"] = true
            reply(id, r)

        case "paste":
            let ok = await Dictation.paste(cmd["text"] as? String ?? "")
            reply(id, ok ? ["ok": true] : ["ok": false, "error": "Machete needs Accessibility permission to type into other apps."])

        case "modifiers.watch":
            let ok = ModifierTaps.watch { key in Out.emit(["type": "modifier", "key": key]) }
            reply(id, ok ? ["ok": true] : ["ok": false, "error": "input-monitoring"])

        case "window.snap":
            do {
                try Windows.snap(cmd["to"] as? String ?? "maximize")
                reply(id, ["ok": true])
            } catch Windows.SnapError.accessibility {
                reply(id, ["ok": false, "error": "accessibility"])
            } catch {
                reply(id, ["ok": false, "error": "no-window"])
            }

        case "clipboard.watch":
            Clipboard.watch { text in Out.emit(["type": "clipboard", "text": text]) }
            reply(id, ["ok": true])

        case "snippets.set":
            let ok = Snippets.set(cmd["items"] as? [[String: Any]] ?? [])
            reply(id, ok ? ["ok": true] : ["ok": false, "error": "input-monitoring"])

        case "selection.read":
            do {
                let s = try await Selection.read()
                reply(id, ["ok": true, "text": s.text, "pid": Int(s.pid)])
            } catch {
                reply(id, ["ok": false, "error": (error as? Selection.ReadError)?.rawValue ?? "no-selection"])
            }

        case "selection.replace":
            do {
                let pasted = try await Selection.replace(cmd["text"] as? String ?? "", pid: pid_t(cmd["pid"] as? Int ?? 0))
                reply(id, ["ok": true, "pasted": pasted])
            } catch {
                reply(id, ["ok": false, "error": "accessibility"])
            }

        case "ping":
            reply(id, ["ok": true])

        default:
            reply(id, ["ok": false, "error": "unknown command"])
        }
    }
}

final class KeepAlive: NSObject, NSApplicationDelegate {
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { .terminateCancel }
}
