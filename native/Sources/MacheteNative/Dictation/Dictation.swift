import AppKit
import ApplicationServices
import CoreGraphics

/// Dictation support: the app being dictated into, and typing the result there.
enum Dictation {
    /// Name and icon (PNG data URL) of the app that has focus.
    static func frontmost() -> [String: Any] {
        guard let app = NSWorkspace.shared.frontmostApplication else { return [:] }
        var out: [String: Any] = ["name": app.localizedName ?? "", "pid": Int(app.processIdentifier)]
        if let icon = app.icon {
            let size = NSSize(width: 64, height: 64)
            let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 64, pixelsHigh: 64, bitsPerSample: 8, samplesPerPixel: 4,
                                       hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
            icon.draw(in: NSRect(origin: .zero, size: size))
            NSGraphicsContext.restoreGraphicsState()
            if let png = rep.representation(using: .png, properties: [:]) {
                out["icon"] = "data:image/png;base64," + png.base64EncodedString()
            }
        }
        return out
    }

    /// Whether Machete may type into other apps (Accessibility). `prompt` shows the system request.
    static func canType(prompt: Bool) -> Bool {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: prompt] as CFDictionary
        return AXIsProcessTrustedWithOptions(opts)
    }

    /// Types `text` into the focused app: puts it on the clipboard, sends ⌘V, then restores the clipboard.
    @MainActor static func paste(_ text: String) async -> Bool {
        guard canType(prompt: true) else { return false }
        let pb = NSPasteboard.general
        let saved = Clipboard.save()
        pb.clearContents()
        pb.setString(text, forType: .string)
        pb.setData(Data(), forType: Clipboard.transient) // not a copy: clipboard history skips it
        let src = CGEventSource(stateID: .combinedSessionState)
        let v: CGKeyCode = 9
        for down in [true, false] {
            let e = CGEvent(keyboardEventSource: src, virtualKey: v, keyDown: down)
            e?.flags = .maskCommand
            e?.post(tap: .cghidEventTap)
        }
        try? await Task.sleep(nanoseconds: 400_000_000)
        Clipboard.restore(saved)
        return true
    }
}
