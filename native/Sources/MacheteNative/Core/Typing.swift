import AppKit
import CoreGraphics

/// Writing without the clipboard, for apps that show another machine: there ⌘V pastes that machine's clipboard, which
/// hasn't got the text yet. What's inserted reaches it letter by letter.
enum Typing {
    /// Grok Bot: its VNC viewer turns ⌘V into Ctrl+Shift+V, and only passes the clipboard on when it gets the focus.
    private static let remote: Set<String> = ["com.anysphere.sand"]
    /// Longer, it would take too long letter by letter.
    private static let longest = 5000
    /// What a keyboard event carries, in UTF-16 units.
    private static let most = 20
    private static let noKey: CGKeyCode = 255

    /// Whether `text` has to be typed into the app in front, rather than pasted.
    @MainActor static func needed(for text: String) -> Bool {
        guard let id = NSWorkspace.shared.frontmostApplication?.bundleIdentifier, remote.contains(id) else { return false }
        return text.utf16.count <= longest && !pieces(text).isEmpty
    }

    @MainActor static func type(_ text: String) async {
        for e in pieces(text).flatMap(events) {
            e.post(tap: .cghidEventTap)
            try? await Task.sleep(nanoseconds: 4_000_000)
        }
    }

    /// One key press that inserts `piece`: no modifiers, and no key of its own (a viewer that sends which key was
    /// pressed, not only its letter, would write another one).
    static func events(_ piece: String) -> [CGEvent] {
        let src = CGEventSource(stateID: .combinedSessionState)
        let units = Array(piece.utf16)
        return [true, false].compactMap { down in
            let e = CGEvent(keyboardEventSource: src, virtualKey: noKey, keyDown: down)
            e?.flags = []
            e?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
            return e
        }
    }

    /// `text` in pieces an event can carry, never splitting a character. None starts with a line break: that would be
    /// the Return key. Empty if it can't be done.
    static func pieces(_ text: String) -> [String] {
        // The viewer drops tabs.
        let plain = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\t", with: "    ")
        var out: [String] = []
        var piece = ""
        for c in plain {
            guard c.utf16.count <= most else { return [] }
            if piece.utf16.count + c.utf16.count > most {
                var next = ""
                // It takes along the letter before the line breaks.
                if c == "\n" {
                    while let last = piece.popLast() {
                        next.insert(last, at: next.startIndex)
                        if last != "\n" { break }
                    }
                }
                if !piece.isEmpty { out.append(piece) }
                piece = next
            }
            piece.append(c)
        }
        if !piece.isEmpty { out.append(piece) }
        return out.contains { $0.first == "\n" || $0.utf16.count > most } ? [] : out
    }
}
