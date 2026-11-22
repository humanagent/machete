import AVFoundation
import Foundation
import Speech

/// Continuous on-device transcription with macOS 26 SpeechAnalyzer + SpeechTranscriber.
/// Live (volatile) words go to onPartial; finalized segments go to onCommit.
@available(macOS 26.0, *)
final class AnalyzerStream: @unchecked Sendable {
    var onCommit: (@MainActor (String) -> Void)?
    var onPartial: (@MainActor (String) -> Void)?

    private let locale: Locale
    private let name: String
    private let lock = NSLock()
    private var builder: AsyncStream<AnalyzerInput>.Continuation?
    private var targetFormat: AVAudioFormat?
    private var paused = false
    private var analyzer: SpeechAnalyzer?
    private var resultsTask: Task<Void, Never>?
    private var converter: AVAudioConverter? // used only from the audio thread
    private var frames = 0, lastLogged = 0
    private var windowPeak: Float = 0
    /// Diagnostics only (`MACHETE_DEBUG_AUDIO=1`): what the analyzer hears,
    /// saved to ~/Library/Logs/Machete-<name>.caf, overwritten each recording.
    private var debugFile: AVAudioFile?
    private var volatileCount = 0

    private func peak(_ b: AVAudioPCMBuffer) -> Float {
        guard let ch = b.floatChannelData?[0] else { return -1 }
        var m: Float = 0
        for i in 0..<Int(b.frameLength) { m = max(m, abs(ch[i])) }
        return m
    }

    init(locale: Locale, name: String) {
        self.locale = locale
        self.name = name
    }

    func start() async throws {
        guard let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale) else {
            throw HelperError(message: "Transcription isn't available for \(locale.identifier) on this Mac.")
        }
        let transcriber = SpeechTranscriber(locale: supported, transcriptionOptions: [], reportingOptions: [.volatileResults],
                                            attributeOptions: [])
        if let req = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            Log.write("[\(name)] downloading speech model for \(supported.identifier)…")
            try await req.downloadAndInstall()
            Log.write("[\(name)] speech model installed")
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber])
        let (sequence, continuation) = AsyncStream<AnalyzerInput>.makeStream()

        lock.lock()
        builder = continuation
        targetFormat = format
        lock.unlock()

        if (ProcessInfo.processInfo.environment["MACHETE_DEBUG_AUDIO"] == "1"), let format {
            let url = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("Logs/Machete-\(name.lowercased()).caf")
            try? FileManager.default.removeItem(at: url)
            debugFile = try? AVAudioFile(forWriting: url, settings: format.settings,
                                         commonFormat: format.commonFormat, interleaved: format.isInterleaved)
            Log.write("[\(name)] debug audio -> \(url.lastPathComponent) \(debugFile != nil ? "ok" : "FAILED")")
        }

        let name = self.name
        resultsTask = Task { [weak self] in
            do {
                for try await result in transcriber.results {
                    let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
                    if !result.isFinal {
                        if let self {
                            self.volatileCount += 1
                            if self.volatileCount == 1 || self.volatileCount % 50 == 0 {
                                Log.write("[\(name)] volatile #\(self.volatileCount) (\(text.count) chars)")
                            }
                        }
                        if let cb = self?.onPartial { await cb(text) }
                        continue
                    }
                    if let cb = self?.onPartial { await cb("") }
                    guard !text.isEmpty else { continue }
                    Log.write("[\(name)] final segment (\(text.split(separator: " ").count) words)")
                    if let cb = self?.onCommit { await cb(text) }
                }
            } catch {
                Log.write("[\(name)] results error: \(error)")
            }
        }
        try await analyzer.start(inputSequence: sequence)
        self.analyzer = analyzer
        Log.write("[\(name)] analyzer started locale=\(supported.identifier) format=\(format.map { "\($0)" } ?? "nil")")
    }

    func setPaused(_ p: Bool) {
        lock.lock(); paused = p; lock.unlock()
    }

    /// Ends input and waits until the last words are transcribed and delivered.
    func finish() async {
        lock.lock()
        let b = builder
        builder = nil
        lock.unlock()
        b?.finish()
        do { try await analyzer?.finalizeAndFinishThroughEndOfInput() } catch {
            Log.write("[\(name)] finalize error: \(error)")
        }
        await resultsTask?.value
        debugFile = nil   // closes the file
        Log.write("[\(name)] finished (volatile results: \(volatileCount))")
    }

    /// Called from audio threads.
    private var calls = 0
    func append(_ buf: AVAudioPCMBuffer) {
        calls += 1
        if calls == 1 {
            Log.write("[\(name)] append #\(calls) builder=\(builder != nil) paused=\(paused) fmt=\(buf.format.sampleRate)/\(buf.format.commonFormat.rawValue)")
        }
        lock.lock()
        let isPaused = paused
        let b = builder
        let fmt = targetFormat
        lock.unlock()
        guard !isPaused, let b else { return }
        frames += Int(buf.frameLength)
        // Loudest sample over each ~10 s window, so a silent source is obvious in the log.
        windowPeak = max(windowPeak, peak(buf))
        let rate = Int(buf.format.sampleRate)
        if frames - lastLogged > rate * 10 {
            lastLogged = frames
            Log.write("[\(name)] audio in: \(frames / max(rate, 1))s peak10s=\(String(format: "%.3f", windowPeak))\(windowPeak < 0.001 ? " (SILENT)" : "")")
            windowPeak = 0
        }

        guard let fmt, buf.format != fmt else {
            try? debugFile?.write(from: buf)
            b.yield(AnalyzerInput(buffer: buf))
            return
        }
        if converter == nil || converter!.inputFormat != buf.format {
            converter = AVAudioConverter(from: buf.format, to: fmt)
        }
        guard let conv = converter else { return }
        let ratio = fmt.sampleRate / buf.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buf.frameLength) * ratio + 64)
        guard let out = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: capacity) else { return }
        var consumed = false
        var err: NSError?
        conv.convert(to: out, error: &err) { _, status in
            if consumed { status.pointee = .noDataNow; return nil }
            consumed = true
            status.pointee = .haveData
            return buf
        }
        if let err { Log.write("[\(name)] convert error: \(err)") }
        if err == nil, out.frameLength > 0 {
            try? debugFile?.write(from: out)
            b.yield(AnalyzerInput(buffer: out))
        }
    }
}
