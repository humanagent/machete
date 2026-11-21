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

    private let locale: Locale
    private var me: SpeechStream?
    private var them: SpeechStream?
    private let mic = MicCapture()
    private let system = SystemAudioCapture()

    init(locale: Locale) { self.locale = locale }

    func start() async throws {
        guard await Self.requestSpeechAuth() else {
            throw CodexError(message: "Speech Recognition permission denied. Enable it in System Settings ▸ Privacy & Security.")
        }
        let micAllowed = await AVCaptureDevice.requestAccess(for: .audio)

        let them = makeStream(.them)
        self.them = them
        them.start()
        system.sink = { [weak them] buf in them?.append(buf) }
        do { try await system.start() } catch {
            onError?("System audio unavailable (grant Screen Recording permission): \(error.localizedDescription)")
        }

        if micAllowed {
            let me = makeStream(.me)
            self.me = me
            me.start()
            do { try mic.start { [weak me] buf in me?.append(buf) } } catch {
                onError?("Microphone unavailable: \(error.localizedDescription)")
            }
        } else {
            onError?("Microphone permission denied — only system audio will be transcribed.")
        }
    }

    func stop() {
        mic.stop()
        system.stop()
        me?.stop(); them?.stop()
        me = nil; them = nil
    }

    private func makeStream(_ speaker: Speaker) -> SpeechStream {
        let s = SpeechStream(locale: locale)
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

    init(locale: Locale) {
        recognizer = SFSpeechRecognizer(locale: locale)
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
                if let text, !text.isEmpty {
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

    @discardableResult
    func swap(_ new: SFSpeechAudioBufferRecognitionRequest?) -> SFSpeechAudioBufferRecognitionRequest? {
        lock.lock(); defer { lock.unlock() }
        let old = request
        request = new
        return old
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); defer { lock.unlock() }
        request?.append(buffer)
    }
}

// MARK: - Audio sources

final class MicCapture {
    private let engine = AVAudioEngine()
    private var running = false

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
    private let queue = DispatchQueue(label: "gpt-helper.system-audio")

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else { throw CodexError(message: "No display") }
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
        NSLog("gpt-helper: system audio stopped: \(error.localizedDescription)")
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
