import AVFoundation
import Foundation
import ScreenCaptureKit
import Speech

/// Live transcript of two sources: microphone ("Me") and system audio ("Them"), on-device when available.
@MainActor
final class Transcriber {
    var onPartial: ((Speaker, String) -> Void)?
    var onCommit: ((Speaker, String) -> Void)?
    var onError: ((String) -> Void)?
    /// Microphone level 0…1, for the dictation pill's waveform.
    var onLevel: ((Float) -> Void)?

    private let locale: Locale
    private var me: SpeechStream?
    private var them: SpeechStream?
    private var me26: AnyObject?
    private var them26: AnyObject?
    private let mic = MicCapture()
    private let system = SystemAudioCapture()

    /// `includeSystem: false` transcribes only the microphone (dictation).
    private let includeSystem: Bool
    init(locale: Locale, includeSystem: Bool = true) { self.locale = locale; self.includeSystem = includeSystem }

    private func micSink(_ append: @escaping (AVAudioPCMBuffer) -> Void) -> (AVAudioPCMBuffer) -> Void {
        { [weak self] buf in
            append(buf)
            guard let level = self?.onLevel, let ch = buf.floatChannelData?[0] else { return }
            let n = Int(buf.frameLength); guard n > 0 else { return }
            var sum: Float = 0
            for i in 0..<n { sum += ch[i] * ch[i] }
            level(min(1, sqrt(sum / Float(n)) * 8))
        }
    }

    func start() async throws {
        Log.write("listen: start locale=\(locale.identifier)")
        let micAllowed = await AVCaptureDevice.requestAccess(for: .audio)
        Log.write("listen: micAllowed=\(micAllowed)")

        if #available(macOS 26.0, *) {
            if includeSystem {
                let them = AnalyzerStream(locale: locale, name: "Them")
                them.onCommit = { [weak self] t in self?.onCommit?(.them, t) }
                them.onPartial = { [weak self] t in self?.onPartial?(.them, t) }
                try await them.start()
                them26 = them
                system.sink = { [weak them] buf in them?.append(buf) }
                do { try await system.start(); Log.write("listen: system audio started") } catch {
                    Log.write("listen: system audio FAILED \(error)")
                    onError?("System audio unavailable (grant Screen & System Audio Recording): \(error.localizedDescription)")
                }
            }
            if micAllowed {
                let me = AnalyzerStream(locale: locale, name: "Me")
                me.onCommit = { [weak self] t in self?.onCommit?(.me, t) }
                me.onPartial = { [weak self] t in self?.onPartial?(.me, t) }
                try await me.start()
                me26 = me
                do { try mic.start(micSink { [weak me] buf in me?.append(buf) }); Log.write("listen: mic started") } catch {
                    Log.write("listen: mic FAILED \(error)")
                    onError?("Microphone unavailable: \(error.localizedDescription)")
                }
            } else if includeSystem {
                onError?("Microphone permission denied — only system audio will be transcribed.")
            } else {
                throw HelperError(message: "Microphone permission denied. Enable it in System Settings ▸ Privacy & Security.")
            }
            return
        }

        guard await Self.requestSpeechAuth() else {
            throw HelperError(message: "Speech Recognition permission denied. Enable it in System Settings ▸ Privacy & Security.")
        }
        if includeSystem {
            let them = makeStream(.them)
            self.them = them
            them.start()
            system.sink = { [weak them] buf in them?.append(buf) }
            do { try await system.start() } catch {
                onError?("System audio unavailable (grant Screen Recording permission): \(error.localizedDescription)")
            }
        }
        if micAllowed {
            let me = makeStream(.me)
            self.me = me
            me.start()
            do { try mic.start(micSink { [weak me] buf in me?.append(buf) }) } catch {
                onError?("Microphone unavailable: \(error.localizedDescription)")
            }
        }
    }

    func setPaused(_ paused: Bool) {
        me?.setPaused(paused)
        them?.setPaused(paused)
        if #available(macOS 26.0, *) {
            (me26 as? AnalyzerStream)?.setPaused(paused)
            (them26 as? AnalyzerStream)?.setPaused(paused)
        }
    }

    /// Stops capturing and waits for the final words to be transcribed.
    func stop() async {
        mic.stop()
        system.stop()
        me?.stop(); them?.stop()
        me = nil; them = nil
        if #available(macOS 26.0, *) {
            let a = me26 as? AnalyzerStream, b = them26 as? AnalyzerStream
            async let x: Void = a?.finish() ?? ()
            async let y: Void = b?.finish() ?? ()
            _ = await (x, y)
        }
        me26 = nil; them26 = nil
    }

    private func makeStream(_ speaker: Speaker) -> SpeechStream {
        let s = SpeechStream(locale: locale, name: speaker.label)
        s.onPartial = { [weak self] t in self?.onPartial?(speaker, t) }
        s.onCommit = { [weak self] t in self?.onCommit?(speaker, t) }
        return s
    }

    private static func requestSpeechAuth() async -> Bool {
        await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0 == .authorized) }
        }
    }
}

/// One recognizer that is rotated on pauses so each utterance becomes a transcript line
/// (and to stay under the per-request duration limit).
@MainActor
final class SpeechStream {
    var onPartial: ((String) -> Void)?
    var onCommit: ((String) -> Void)?

    private let recognizer: SFSpeechRecognizer?
    private let requestBox = RequestBox()
    private var task: SFSpeechRecognitionTask?
    private var generation = 0
    private var running = false
    private var lastPartial = ""
    private var silenceTimer: Timer?
    private var maxTimer: Timer?

    private let name: String

    init(locale: Locale, name: String) {
        self.name = name
        recognizer = SFSpeechRecognizer(locale: locale)
        Log.write("[\(name)] recognizer=\(recognizer != nil) available=\(recognizer?.isAvailable ?? false) onDevice=\(recognizer?.supportsOnDeviceRecognition ?? false)")
    }

    func start() {
        running = true
        rotate()
    }

    func stop() {
        running = false
        rotate()
        silenceTimer?.invalidate(); maxTimer?.invalidate()
    }

    nonisolated func append(_ buffer: AVAudioPCMBuffer) {
        requestBox.append(buffer)
    }

    func setPaused(_ p: Bool) {
        requestBox.paused = p
        if p { rotate() } // commit whatever was said before pausing
    }

    private func rotate() {
        silenceTimer?.invalidate()
        maxTimer?.invalidate()
        generation += 1
        let gen = generation

        let old = requestBox.swap(nil)
        old?.endAudio()
        task?.cancel()
        task = nil

        let text = lastPartial.trimmingCharacters(in: .whitespacesAndNewlines)
        lastPartial = ""
        if !text.isEmpty { onCommit?(text) }
        onPartial?("")

        guard running, let recognizer else { return }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.addsPunctuation = true
        req.taskHint = .dictation
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        requestBox.swap(req)

        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let failed = error != nil
            DispatchQueue.main.async {
                guard let self, gen == self.generation else { return }
                if let error { Log.write("[\(self.name)] task error: \((error as NSError).domain) \((error as NSError).code) \(error.localizedDescription)") }
                if let text, !text.isEmpty {
                    if self.lastPartial.isEmpty { Log.write("[\(self.name)] got speech (\(text.count) chars)") }
                    self.lastPartial = text
                    self.onPartial?(text)
                    self.armSilenceTimer()
                }
                if isFinal { self.rotate() }
                else if failed && result == nil {
                    // e.g. "no speech detected" — restart shortly.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                        if gen == self.generation, self.running { self.rotate() }
                    }
                }
            }
        }

        maxTimer = Timer.scheduledTimer(withTimeInterval: 45, repeats: false) { [weak self] _ in
            Task { @MainActor in if gen == self?.generation { self?.rotate() } }
        }
    }

    private func armSilenceTimer() {
        silenceTimer?.invalidate()
        let gen = generation
        silenceTimer = Timer.scheduledTimer(withTimeInterval: 1.4, repeats: false) { [weak self] _ in
            Task { @MainActor in
                guard let self, gen == self.generation, !self.lastPartial.isEmpty else { return }
                self.rotate()
            }
        }
    }
}

/// Thread-safe holder so audio threads can append while the main thread rotates requests.
final class RequestBox: @unchecked Sendable {
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var _paused = false
    var paused: Bool {
        get { lock.lock(); defer { lock.unlock() }; return _paused }
        set { lock.lock(); _paused = newValue; lock.unlock() }
    }

    @discardableResult
    func swap(_ new: SFSpeechAudioBufferRecognitionRequest?) -> SFSpeechAudioBufferRecognitionRequest? {
        lock.lock(); defer { lock.unlock() }
        let old = request
        request = new
        return old
    }

    private var count = 0
    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); defer { lock.unlock() }
        count += 1
        if count == 1 || count % 500 == 0 { Log.write("audio buffers=\(count) fmt=\(buffer.format.sampleRate)Hz ch=\(buffer.format.channelCount) frames=\(buffer.frameLength) hasRequest=\(request != nil)") }
        if _paused { return }
        request?.append(buffer)
    }
}

// MARK: - Audio sources

final class MicCapture {
    private let engine = AVAudioEngine()
    private var running = false
    var formatDescription: String { "\(engine.inputNode.outputFormat(forBus: 0))" }

    func start(_ sink: @escaping (AVAudioPCMBuffer) -> Void) throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { buf, _ in sink(buf) }
        engine.prepare()
        try engine.start()
        running = true
    }

    func stop() {
        guard running else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        running = false
    }
}

final class SystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    var sink: ((AVAudioPCMBuffer) -> Void)?
    private var stream: SCStream?
    private let queue = DispatchQueue(label: "machete.system-audio")

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else { throw HelperError(message: "No display") }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48_000
        config.channelCount = 1
        // Video is required by SCStream; keep it tiny and slow.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        let s = SCStream(filter: filter, configuration: config, delegate: self)
        try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try await s.startCapture()
        stream = s
    }

    func stop() {
        let s = stream
        stream = nil
        Task { try? await s?.stopCapture() }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, let pcm = sampleBuffer.pcmBuffer() else { return }
        sink?(pcm)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        Log.write("system audio stopped: \(error)")
        Log.write("system audio stopped: \(error.localizedDescription)")
    }
}

extension CMSampleBuffer {
    func pcmBuffer() -> AVAudioPCMBuffer? {
        guard let desc = CMSampleBufferGetFormatDescription(self),
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(desc) else { return nil }
        var asbd = asbdPtr.pointee
        guard let format = AVAudioFormat(streamDescription: &asbd) else { return nil }
        let frames = AVAudioFrameCount(CMSampleBufferGetNumSamples(self))
        guard frames > 0, let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        buf.frameLength = frames
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(self, at: 0, frameCount: Int32(frames),
                                                                   into: buf.mutableAudioBufferList)
        return status == noErr ? buf : nil
    }
}
