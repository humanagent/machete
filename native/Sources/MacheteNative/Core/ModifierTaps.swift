import AppKit
import CoreGraphics

/// Right-hand modifier keys tapped on their own: pressed and released quickly, with no other key, modifier or click
/// in between.
enum ModifierTaps {
    private struct Key { let name: String; let mask: CGEventFlags; let device: UInt64 }
    /// Key code -> its name, its flag, and the bit that tells the right key from the left one (NX_DEVICER…KEYMASK).
    private static let keys: [Int64: Key] = [
        61: Key(name: "RightAlt", mask: .maskAlternate, device: 0x40),
        54: Key(name: "RightCommand", mask: .maskCommand, device: 0x10),
        62: Key(name: "RightControl", mask: .maskControl, device: 0x2000),
        60: Key(name: "RightShift", mask: .maskShift, device: 0x04),
    ]
    private static let modifiers: CGEventFlags = [.maskAlternate, .maskCommand, .maskControl, .maskShift]
    /// Held longer, it isn't a tap.
    private static let longest: TimeInterval = 0.8

    private static var onTap: ((String) -> Void)?
    private static var tap: CFMachPort?
    private static var down: Int64?
    private static var downAt = Date.distantPast
    @MainActor private static var asked = false

    /// False without Input Monitoring: the tap would be created but never receive a key. It asks once; the app
    /// retries, and its permissions guide takes over from there.
    @MainActor static func watch(_ onTap: @escaping (String) -> Void) -> Bool {
        guard CGPreflightListenEventAccess() else {
            if !asked { asked = true; CGRequestListenEventAccess() }
            return false
        }
        self.onTap = onTap
        if tap != nil { return true }
        let types: [CGEventType] = [.flagsChanged, .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown]
        let mask = types.reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
        guard let t = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                        eventsOfInterest: mask, callback: { _, type, event, _ in
            ModifierTaps.handle(type, event)
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
        guard type == .flagsChanged else { down = nil; return } // a key or a click: it was a combination
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        guard let key = keys[code] else { down = nil; return } // another modifier joined
        if event.flags.rawValue & key.device != 0 {
            // Only this key: no other modifier, and not its left-hand twin.
            let alone = event.flags.intersection(modifiers) == key.mask && event.flags.rawValue & twin(code) == 0
            down = alone && down == nil ? code : nil
            downAt = Date()
        } else {
            if down == code, Date().timeIntervalSince(downAt) < longest { onTap?(key.name) }
            down = nil
        }
    }

    /// NX_DEVICEL…KEYMASK of the same modifier on the left.
    private static func twin(_ code: Int64) -> UInt64 {
        switch code {
        case 61: 0x20
        case 54: 0x08
        case 62: 0x01
        default: 0x02
        }
    }
}
