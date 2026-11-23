import AVFoundation
import Foundation

/// What a long recording puts on the helper, without a microphone or a screen. For tests.
enum Load {
    private static func note(_ s: String) { FileHandle.standardError.write(Data((s + "\n").utf8)) }

    /// Reports `lines` lines, word by word, from a background thread, as the audio and speech ones do.
    static func output(lines: Int) {
        let done = DispatchSemaphore(value: 0)
        let start = Date()
        Thread.detachNewThread {
            for i in 0..<lines {
                autoreleasepool {
                    for w in 1...12 {
                        Out.emit(["type": "partial", "speaker": "them", "text": String(repeating: "word ", count: w)])
                    }
                    Out.emit(["type": "commit", "speaker": "them", "text": "line \(i)"])
                }
            }
            done.signal()
        }
        done.wait()
        note("reported in \(Int(Date().timeIntervalSince(start) * 1000)) ms")
        Out.flush()
    }

    @available(macOS 26.0, *)
    @MainActor static func soak(_ url: URL, locale: Locale, seconds: Int) async throws {
        var commits = 0, failures = 0
        var streams: [AnalyzerStream] = []
        for name in ["Me", "Them"] {
            let s = AnalyzerStream(locale: locale, name: name)
            s.onCommit = { _ in commits += 1 }
            s.onPartial = { _ in }
            s.onFailure = { _ in failures += 1 }
            try await s.start()
            streams.append(s)
        }
        let live = streams
        let start = Date()
        Thread.detachNewThread {
            guard let file = try? AVAudioFile(forReading: url) else { return }
            let frames = AVAudioFrameCount(file.processingFormat.sampleRate / 50) // 20 ms, like system audio
            var i = 0
            while Date().timeIntervalSince(start) < Double(seconds) {
                autoreleasepool {
                    if file.framePosition >= file.length { file.framePosition = 0 }
                    guard let buf = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames) else { return }
                    try? file.read(into: buf, frameCount: frames)
                    for s in live { s.append(buf) }
                }
                i += 1
                let wait = start.addingTimeInterval(Double(i) * 0.02).timeIntervalSinceNow
                if wait > 0 { Thread.sleep(forTimeInterval: wait) }
            }
        }
        while Date().timeIntervalSince(start) < Double(seconds) {
            try await Task.sleep(nanoseconds: 30_000_000_000)
            note("t=\(Int(Date().timeIntervalSince(start)))s footprint=\(footprint())MB commits=\(commits) failures=\(failures)")
        }
        let stop = Date()
        for s in streams { await s.finish() }
        let took = String(format: "%.2f", Date().timeIntervalSince(stop))
        note("finish took \(took)s footprint=\(footprint())MB commits=\(commits) failures=\(failures)")
    }

    private static func footprint() -> String {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        _ = withUnsafeMutablePointer(to: &info) { p in
            p.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        return String(format: "%.1f", Double(info.phys_footprint) / 1_048_576)
    }
}
