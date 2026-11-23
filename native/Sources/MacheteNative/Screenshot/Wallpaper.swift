import AppKit
import ScreenCaptureKit

/// The desktop picture as it looks now, whatever draws it (a file, a dynamic or an animated wallpaper):
/// the Dock's wallpaper window of the screen under the pointer.
enum Wallpaper {
    static func dataURL(maxLongSide: Double = 2560) async throws -> String {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main
        let displayID = screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID
        let display = content.displays.first { $0.displayID == displayID }
        let windows = content.windows.filter {
            $0.owningApplication?.bundleIdentifier == "com.apple.dock" && ($0.title ?? "").hasPrefix("Wallpaper-")
        }
        guard let window = windows.first(where: { $0.frame == display?.frame }) ?? windows.first else {
            throw HelperError(message: "No wallpaper window.")
        }
        let scale = min(Double(screen?.backingScaleFactor ?? 2), maxLongSide / max(window.frame.width, window.frame.height))
        let config = SCStreamConfiguration()
        config.width = Int(window.frame.width * scale)
        config.height = Int(window.frame.height * scale)
        config.showsCursor = false
        let image = try await SCScreenshotManager.captureImage(
            contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: config)
        guard let jpg = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.85]) else {
            throw HelperError(message: "Could not encode the wallpaper.")
        }
        return "data:image/jpeg;base64," + jpg.base64EncodedString()
    }
}
