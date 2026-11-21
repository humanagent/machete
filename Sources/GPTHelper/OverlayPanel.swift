import AppKit
import SwiftUI

/// Floating, non-activating panel. Excluded from screen sharing / screenshots via `sharingType = .none`.
final class OverlayPanel: NSPanel {
    private var anchorTop: CGFloat?

    init<V: View>(rootView: V) {
        super.init(contentRect: NSRect(x: 0, y: 0, width: 660, height: 60),
                   styleMask: [.nonactivatingPanel, .borderless, .fullSizeContentView],
                   backing: .buffered, defer: false)
        isFloatingPanel = true
        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        backgroundColor = .clear
        isOpaque = false
        hasShadow = true
        hidesOnDeactivate = false
        isMovableByWindowBackground = true
        sharingType = .none

        let host = NSHostingController(rootView: rootView)
        host.sizingOptions = [.preferredContentSize]
        host.view.wantsLayer = true
        host.view.layer?.backgroundColor = .clear
        contentViewController = host

        NotificationCenter.default.addObserver(forName: NSWindow.didMoveNotification, object: self, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.anchorTop = self.frame.maxY
        }
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    func positionTopCenter() {
        // Always the Mac's built-in display; fall back to the primary screen if it's closed/absent.
        let screen = NSScreen.screens.first { s in
            guard let id = s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID else { return false }
            return CGDisplayIsBuiltin(id) != 0
        } ?? NSScreen.screens.first
        guard let vf = screen?.visibleFrame else { return }
        let x = vf.midX - frame.width / 2
        anchorTop = vf.maxY - 6
        setFrameOrigin(NSPoint(x: x, y: vf.maxY - 6 - frame.height))
    }

    /// Keep the top edge pinned when SwiftUI content grows or shrinks.
    override func setFrame(_ frameRect: NSRect, display flag: Bool) {
        var f = frameRect
        if frame.height > 0, frameRect.size != frame.size {
            f.origin.y = (anchorTop ?? frame.maxY) - frameRect.height
            f.origin.x = frame.midX - frameRect.width / 2
        }
        super.setFrame(f, display: flag)
    }
}
