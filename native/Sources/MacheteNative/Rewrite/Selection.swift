import AppKit
import ApplicationServices
import Carbon

/// The text selected in the app in front: read it, and later replace it with a rewritten version.
enum Selection {
    enum ReadError: String, Error {
        case accessibility
        case secure
        case none = "no-selection"
    }

    /// Pasting doesn't replace the selection in a terminal (and could run something): there it is only copied.
    private static let terminals = ["terminal", "iterm", "ghostty", "kitty", "wezterm", "warp", "alacritty", "cmux", "hyper"]

    /// The selected text and the app it belongs to. Asks Accessibility first; apps that don't answer get a ⌘C,
    /// and the clipboard is put back.
    @MainActor static func read() async throws -> (text: String, pid: pid_t) {
        guard Dictation.canType(prompt: true) else { throw ReadError.accessibility }
        guard !IsSecureEventInputEnabled() else { throw ReadError.secure } // a password is being typed
        guard let app = NSWorkspace.shared.frontmostApplication else { throw ReadError.none }
        let pid = app.processIdentifier
        if let field = focusedElement(pid) {
            if string(field, kAXSubroleAttribute) == kAXSecureTextFieldSubrole as String { throw ReadError.secure }
            if let text = string(field, kAXSelectedTextAttribute), !blank(text) { return (text, pid) }
        }
        await modifiersReleased()
        guard let text = await copy(), !blank(text) else { throw ReadError.none }
        return (text, pid)
    }

    /// Pastes `text` over the selection of `pid`. False when that app is no longer in front, or is a terminal:
    /// the text is left on the clipboard instead.
    @MainActor static func replace(_ text: String, pid: pid_t) async throws -> Bool {
        guard Dictation.canType(prompt: true) else { throw ReadError.accessibility }
        let front = NSWorkspace.shared.frontmostApplication
        let id = (front?.bundleIdentifier ?? "").lowercased()
        guard front?.processIdentifier == pid, !terminals.contains(where: id.contains) else {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            return false
        }
        await modifiersReleased()
        return await Dictation.paste(text)
    }

    private static func blank(_ s: String) -> Bool { s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private static func focusedElement(_ pid: pid_t) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.5)
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &v) == .success,
              let v, CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
        return (v as! AXUIElement)
    }

    private static func string(_ e: AXUIElement, _ attribute: String) -> String? {
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(e, attribute as CFString, &v) == .success else { return nil }
        return v as? String
    }

    /// The shortcut's own ⌥ or ⇧ would turn ⌘C into something else: waits (a second at most) until it is let go.
    private static func modifiersReleased() async {
        for _ in 0..<50 {
            let held = CGEventSource.flagsState(.hidSystemState)
                .intersection([.maskCommand, .maskAlternate, .maskControl, .maskShift])
            if held.isEmpty { return }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
    }

    @MainActor private static func copy() async -> String? {
        let pb = NSPasteboard.general
        let saved = Clipboard.save()
        Clipboard.paused = true // this copy isn't the user's: it stays out of the history
        defer { Clipboard.resume() }
        let before = pb.changeCount
        let src = CGEventSource(stateID: .combinedSessionState)
        for down in [true, false] {
            let e = CGEvent(keyboardEventSource: src, virtualKey: 8, keyDown: down) // C
            e?.flags = .maskCommand
            e?.post(tap: .cghidEventTap)
        }
        for _ in 0..<25 where pb.changeCount == before { try? await Task.sleep(nanoseconds: 20_000_000) }
        guard pb.changeCount != before else { return nil }
        // VS Code copies the whole line when nothing is selected, and says so.
        let chromium = pb.data(forType: NSPasteboard.PasteboardType("org.chromium.web-custom-data"))
        let wholeLine = chromium.flatMap { String(data: $0, encoding: .utf16LittleEndian) }?
            .contains("\"isFromEmptySelection\":true") ?? false
        let text = wholeLine ? nil : pb.string(forType: .string)
        Clipboard.restore(saved)
        return text
    }
}
