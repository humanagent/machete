import AppKit
import SQLite3

/// Snippets: type an abbreviation anywhere and it becomes its text. A listen-only keyboard tap keeps the last
/// few characters typed; when they end with an abbreviation (at the start of a word, or anywhere if the
/// abbreviation starts with a symbol like ";"), the abbreviation is erased and the text pasted.
/// Needs Input Monitoring (to see keys) and Accessibility (to type). Password fields are never seen (macOS
/// hides them from taps).
enum Snippets {
    private static var expansions: [(abbreviation: String, content: String)] = []
    private static var buffer = ""
    private static var tap: CFMachPort?
    private static var expanding = false
    private static let maxBuffer = 64

    /// Replaces the abbreviations; starts the tap the first time. False when Input Monitoring is missing.
    @MainActor static func set(_ items: [[String: Any]]) -> Bool {
        expansions = items.compactMap { item in
            guard let a = item["abbreviation"] as? String, let c = item["content"] as? String, !a.isEmpty else { return nil }
            return (a, c)
        }.sorted { $0.abbreviation.count > $1.abbreviation.count } // the longest match wins
        buffer = ""
        if tap != nil { return true }
        guard CGPreflightListenEventAccess() else { return false }
        let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.leftMouseDown.rawValue)
            | (1 << CGEventType.rightMouseDown.rawValue)
        guard let t = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .listenOnly,
                                        eventsOfInterest: CGEventMask(mask), callback: { _, type, event, _ in
            Snippets.handle(type, event)
            return Unmanaged.passUnretained(event)
        }, userInfo: nil) else { return false }
        CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, t, 0), .commonModes)
        CGEvent.tapEnable(tap: t, enable: true)
        tap = t
        return true
    }

    private static func handle(_ type: CGEventType, _ event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return
        }
        // Our own backspaces and ⌘V.
        if expanding || event.getIntegerValueField(.eventSourceUnixProcessID) == Int64(getpid()) { return }
        guard type == .keyDown else { buffer = ""; return } // a click moves the caret
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        if !event.flags.intersection([.maskCommand, .maskControl]).isEmpty { buffer = ""; return }
        switch code {
        case 51: if !buffer.isEmpty { buffer.removeLast() }; return // delete
        case 36, 48, 76: buffer = " "; return // return, tab, enter: a word boundary
        case 53, 115...126: buffer = ""; return // esc, arrows, home/end/page keys
        default: break
        }
        var length = 0
        var chars = [UniChar](repeating: 0, count: 8)
        event.keyboardGetUnicodeString(maxStringLength: 8, actualStringLength: &length, unicodeString: &chars)
        guard length > 0 else { return }
        buffer += String(utf16CodeUnits: chars, count: length)
        if buffer.count > maxBuffer { buffer.removeFirst(buffer.count - maxBuffer) }
        guard let match = expansions.first(where: { matches($0.abbreviation) }) else { return }
        buffer = ""
        expanding = true
        DispatchQueue.main.async {
            Task { @MainActor in
                erase(match.abbreviation.count)
                _ = await Dictation.paste(match.content)
                expanding = false
            }
        }
    }

    /// The typed text ends with `abbreviation`, and it starts a word (or begins with a symbol).
    private static func matches(_ abbreviation: String) -> Bool {
        guard buffer.hasSuffix(abbreviation) else { return false }
        guard let first = abbreviation.unicodeScalars.first, CharacterSet.alphanumerics.contains(first) else { return true }
        let before = buffer.dropLast(abbreviation.count)
        guard let prev = before.last?.unicodeScalars.first else { return true }
        return !CharacterSet.alphanumerics.contains(prev)
    }

    private static func erase(_ count: Int) {
        let src = CGEventSource(stateID: .combinedSessionState)
        for _ in 0..<count {
            for down in [true, false] {
                CGEvent(keyboardEventSource: src, virtualKey: 51, keyDown: down)?.post(tap: .cghidEventTap)
            }
        }
    }

    /// The Mac's own text replacements (System Settings › Keyboard), for importing.
    static func macTextReplacements() -> [[String: String]]? {
        let path = NSHomeDirectory() + "/Library/KeyboardServices/TextReplacements.db"
        var db: OpaquePointer?
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_close(db) }
        var stmt: OpaquePointer?
        let sql = "SELECT ZSHORTCUT, ZPHRASE FROM ZTEXTREPLACEMENTENTRY WHERE ZWASDELETED = 0"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }
        var out: [[String: String]] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let s = sqlite3_column_text(stmt, 0), let p = sqlite3_column_text(stmt, 1) else { continue }
            out.append(["abbreviation": String(cString: s), "content": String(cString: p)])
        }
        return out
    }
}
