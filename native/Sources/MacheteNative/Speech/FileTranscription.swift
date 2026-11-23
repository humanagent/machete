import AVFoundation
import Foundation

/// Runs an audio file through AnalyzerStream exactly as live audio would arrive (buffers in the file's own format),
/// and returns the joined final text.
@available(macOS 26.0, *)
enum FileTranscription {
    @MainActor static func run(_ url: URL, locale: Locale) async throws -> String {
        let file = try AVAudioFile(forReading: url)
        let stream = AnalyzerStream(locale: locale, name: "File", live: false)
        let parts = Parts()
        stream.onCommit = { parts.items.append($0) }
        stream.onPartial = { if !$0.isEmpty { parts.partial = $0 } }
        try await stream.start()
        let chunk: AVAudioFrameCount = 4096
        while file.framePosition < file.length {
            guard let buf = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: chunk) else { break }
            try file.read(into: buf, frameCount: chunk)
            if buf.frameLength == 0 { break }
            stream.append(buf)
        }
        await stream.finish()
        return parts.items.isEmpty ? "(partial) " + parts.partial : parts.items.joined(separator: " ")
    }

    @MainActor final class Parts { var items: [String] = []; var partial = "" }
}
