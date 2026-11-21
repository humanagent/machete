import Foundation

/// Appends diagnostic lines to ~/Library/Logs/gpt-helper.log (no audio or transcript content).
enum Log {
    private static let url: URL = {
        let dir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Logs")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("gpt-helper.log")
    }()
    private static let queue = DispatchQueue(label: "gpt-helper.log")
    private static let fmt: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm:ss.SSS"; return f }()

    static func write(_ msg: String) {
        let line = "\(fmt.string(from: Date())) \(msg)\n"
        queue.async {
            if let h = try? FileHandle(forWritingTo: url) {
                h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close()
            } else {
                try? Data(line.utf8).write(to: url)
            }
        }
    }
}
