import AppKit
import ApplicationServices
import CoreGraphics

/// Dictation support: the right ⌘ key as a trigger, the app being dictated into, and typing the result there.
enum Dictation {
    /// Watches for the right Command key pressed and released on its own (no other key in between).
    /// Needs Input Monitoring or Accessibility; returns false if macOS refuses the event tap.
    @MainActor static func watchRightCommand(_ onTap: @escaping () -> Void) -> Bool {
        // Without Input Monitoring the tap is created but never receives a key: ask, and report it.
        guard CGPreflightListenEventAccess() else {
            CGRequestListenEventAccess()
            return false
        }
        RightCommand.onTap = onTap
        let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                          eventsOfInterest: CGEventMask(mask), callback: { _, type, event, _ in
            RightCommand.handle(type, event)
            return Unmanaged.passUnretained(event)
        }, userInfo: nil) else { return false }
        let src = CFMachPortCreateRunLoopSource(nil, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), src, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        RightCommand.tap = tap
        return true
    }

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
        let saved = pb.pasteboardItems?.map { item -> [NSPasteboard.PasteboardType: Data] in
            var d: [NSPasteboard.PasteboardType: Data] = [:]
            for t in item.types { if let v = item.data(forType: t) { d[t] = v } }
            return d
        } ?? []
        pb.clearContents()
        pb.setString(text, forType: .string)
        let src = CGEventSource(stateID: .combinedSessionState)
        let v: CGKeyCode = 9
        for down in [true, false] {
            let e = CGEvent(keyboardEventSource: src, virtualKey: v, keyDown: down)
            e?.flags = .maskCommand
            e?.post(tap: .cghidEventTap)
        }
        try? await Task.sleep(nanoseconds: 400_000_000)
        pb.clearContents()
        for d in saved {
            let item = NSPasteboardItem()
            for (t, v) in d { item.setData(v, forType: t) }
            pb.writeObjects([item])
        }
        return true
    }
}

private enum RightCommand {
    static var onTap: (() -> Void)?
    static var tap: CFMachPort?
    static var down = false
    static var clean = false

    static func handle(_ type: CGEventType, _ event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return
        }
        if type == .keyDown { clean = false; return }
        guard type == .flagsChanged else { return }
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        if code == 54 { // right Command
            let pressed = event.flags.contains(.maskCommand)
            if pressed && !down { down = true; clean = event.flags.intersection([.maskShift, .maskControl, .maskAlternate]).isEmpty }
            else if !pressed && down {
                down = false
                if clean { DispatchQueue.main.async { onTap?() } }
            }
        } else {
            clean = false // another modifier changed while right ⌘ was held
        }
    }
}
