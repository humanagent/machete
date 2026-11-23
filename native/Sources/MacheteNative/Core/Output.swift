import Foundation

/// Line-delimited JSON on stdout: the only channel to the Electron main process.
enum Out {
    /// Writing waits whenever Electron is slow to read: only this queue does, never the audio threads or the main one.
    private static let queue = DispatchQueue(label: "machete.stdout", autoreleaseFrequency: .workItem)
    private static let lock = NSLock()
    private static var waiting = 0
    /// Past this many lines waiting, the ones a newer line replaces anyway (words in progress, levels, logs) are dropped.
    private static let backlog = 256
    private static let disposable: Set<String> = ["partial", "dictation.level", "log"]

    static func emit(_ obj: [String: Any]) {
        let replaceable = (obj["type"] as? String).map(disposable.contains) ?? false
        lock.lock()
        let drop = replaceable && waiting >= backlog
        if !drop { waiting += 1 }
        lock.unlock()
        if drop { return }
        guard var data = try? JSONSerialization.data(withJSONObject: obj) else { return written() }
        data.append(0x0A)
        queue.async {
            FileHandle.standardOutput.write(data)
            written()
        }
    }

    private static func written() {
        lock.lock(); waiting -= 1; lock.unlock()
    }

    /// Waits until everything emitted so far is out (before exiting).
    static func flush() { queue.sync {} }

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
