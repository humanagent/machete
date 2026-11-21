import AppKit
import ScreenCaptureKit
import UniformTypeIdentifiers

enum ScreenCapture {
    /// Captures the display under the mouse, excluding gpt-helper's own windows. Returns a PNG file URL.
    /// JPEG data URL of the screen under the mouse, sized for fast upload.
    static func captureDataURL(maxLongSide: Int = 1440) async throws -> String {
        let image = try await captureImage(maxLongSide: maxLongSide)
        let rep = NSBitmapImageRep(cgImage: image)
        guard let jpg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7]) else {
            throw CodexError(message: "Could not encode screenshot.")
        }
        return "data:image/jpeg;base64," + jpg.base64EncodedString()
    }

    static func captureScreenUnderMouse(maxLongSide: Int = 1440) async throws -> URL {
        let image = try await captureImage(maxLongSide: maxLongSide)
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("gpt-helper-\(UUID().uuidString).png")
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw CodexError(message: "Could not write screenshot.")
        }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { throw CodexError(message: "Could not write screenshot.") }
        return url
    }

    static func captureImage(maxLongSide: Int) async throws -> CGImage {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)

        let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main
        let displayID = screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID
        guard let display = content.displays.first(where: { $0.displayID == displayID }) ?? content.displays.first else {
            throw CodexError(message: "No display available to capture. Grant Screen Recording permission in System Settings.")
        }

        let mine = content.applications.filter { $0.processID == ProcessInfo.processInfo.processIdentifier }
        let filter = SCContentFilter(display: display, excludingApplications: mine, exceptingWindows: [])

        let scale = screen?.backingScaleFactor ?? 2
        var w = Int(Double(display.width) * scale)
        var h = Int(Double(display.height) * scale)
        let longSide = max(w, h)
        if longSide > maxLongSide {
            let f = Double(maxLongSide) / Double(longSide)
            w = Int(Double(w) * f); h = Int(Double(h) * f)
        }
        let config = SCStreamConfiguration()
        config.width = w
        config.height = h
        config.showsCursor = false

        return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    }
}
