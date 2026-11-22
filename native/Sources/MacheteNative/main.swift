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
//   {"id":8,"cmd":"rightcmd.watch"}                  -> {"id":8,"ok":true|false}; then {"type":"rightcmd"} on each lone right-⌘ tap
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

case "serve":
    if let i = args.firstIndex(of: "--exclude-pid"), i + 1 < args.count, let pid = pid_t(args[i + 1]) {
        Capture.excludedPIDs.insert(pid)
    }
    // AppKit context for NSScreen / NSEvent.mouseLocation; never shows in the Dock.
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    MainActor.assumeIsolated { Server.shared.run() }
    app.run()

default:
    fail("usage: machete-native serve|extract|icon")
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
            while let line = readLine(strippingNewline: true) {
                guard let data = line.data(using: .utf8),
                      let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
                Task { @MainActor in await Server.shared.handle(obj) }
            }
            // Parent closed stdin (Electron quit): stop cleanly and exit.
            Task { @MainActor in
                await Server.shared.transcriber?.stop()
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

        case "listen.start":
            await transcriber?.stop()
            let t = Transcriber(locale: Locale(identifier: cmd["locale"] as? String ?? "en-US"))
            t.onPartial = { speaker, text in Out.emit(["type": "partial", "speaker": speaker.rawValue, "text": text]) }
            t.onCommit = { speaker, text in Out.emit(["type": "commit", "speaker": speaker.rawValue, "text": text]) }
            t.onError = { message in Out.emit(["type": "error", "message": message]) }
            transcriber = t
            do {
                try await t.start()
                reply(id, ["ok": true])
            } catch {
                transcriber = nil
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
                       "screen": CGPreflightScreenCaptureAccess() ? "granted" : "denied"])

        case "dictate.start":
            await dictation?.stop()
            dictationText = []; dictationPartial = ""
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
            do { try await d.start(); reply(id, ["ok": true]) } catch {
                dictation = nil
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

        case "rightcmd.watch":
            let ok = Dictation.watchRightCommand { Out.emit(["type": "rightcmd"]) }
            reply(id, ok ? ["ok": true] : ["ok": false, "error": "Input Monitoring permission needed for the right ⌘ key."])

        case "ping":
            reply(id, ["ok": true])

        default:
            reply(id, ["ok": false, "error": "unknown command"])
        }
    }
}
