import AppKit
import ApplicationServices

/// Window snapping: moves the focused window of the frontmost app to the left half, the right half or the
/// whole of its screen (the visible area: no menu bar, no Dock). Needs Accessibility.
enum Windows {
    enum SnapError: Error { case accessibility, noWindow }

    @MainActor static func snap(_ to: String) throws {
        guard AXIsProcessTrusted() else { throw SnapError.accessibility }
        guard let app = NSWorkspace.shared.frontmostApplication else { throw SnapError.noWindow }
        let axApp = AXUIElementCreateApplication(app.processIdentifier)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &value) == .success,
              let ref = value, CFGetTypeID(ref) == AXUIElementGetTypeID() else { throw SnapError.noWindow }
        let window = ref as! AXUIElement

        // AX frames are top-left based on the primary screen; NSScreen frames are bottom-left based.
        guard let primary = NSScreen.screens.first else { throw SnapError.noWindow }
        let current = frame(of: window)
        let center = CGPoint(x: current.midX, y: primary.frame.height - current.midY)
        let screen = NSScreen.screens.first { $0.frame.contains(center) } ?? NSScreen.main ?? primary
        let v = screen.visibleFrame
        let area = CGRect(x: v.minX, y: primary.frame.height - v.maxY, width: v.width, height: v.height)

        let half = (area.width / 2).rounded()
        let target: CGRect
        switch to {
        case "left": target = CGRect(x: area.minX, y: area.minY, width: half, height: area.height)
        case "right": target = CGRect(x: area.minX + half, y: area.minY, width: area.width - half, height: area.height)
        default: target = area
        }
        // Size, position, size again: a window that can't grow past its screen yet gets its full size once moved.
        set(window, size: target.size)
        set(window, origin: target.origin)
        set(window, size: target.size)
    }

    private static func frame(of window: AXUIElement) -> CGRect {
        var origin = CGPoint.zero, size = CGSize.zero
        var v: CFTypeRef?
        if AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &v) == .success, let v {
            AXValueGetValue(v as! AXValue, .cgPoint, &origin)
        }
        if AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &v) == .success, let v {
            AXValueGetValue(v as! AXValue, .cgSize, &size)
        }
        return CGRect(origin: origin, size: size)
    }

    private static func set(_ window: AXUIElement, origin: CGPoint) {
        var p = origin
        if let v = AXValueCreate(.cgPoint, &p) { AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, v) }
    }

    private static func set(_ window: AXUIElement, size: CGSize) {
        var s = size
        if let v = AXValueCreate(.cgSize, &s) { AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, v) }
    }
}
