import Foundation

/// Line-delimited JSON on stdout: the only channel to the Electron main process.
enum Out {
    private static let lock = NSLock()

    static func emit(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              var line = String(data: data, encoding: .utf8) else { return }
        line += "\n"
        lock.lock(); defer { lock.unlock() }
        FileHandle.standardOutput.write(Data(line.utf8))
    }

    static func log(_ msg: String) { emit(["type": "log", "message": msg]) }
}

struct HelperError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

enum Speaker: String {
    case me, them
    var label: String { self == .me ? "Me" : "Them" }
}

/// Same diagnostics the native app writes (forwarded to ~/Library/Logs/Machete.log by the main process).
enum Log {
    static func write(_ msg: String) { Out.log(msg) }
}
