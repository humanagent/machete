import AppKit
import ScreenCaptureKit
import UniformTypeIdentifiers

/// Same capture as the native app (ScreenCapture.swift): the display under the mouse, without
/// Machete's own windows. The Electron main process passes its pid so its windows are excluded.
enum Capture {
    static var excludedPIDs: Set<pid_t> = [ProcessInfo.processInfo.processIdentifier]

    /// JPEG data URL of the screen under the mouse, sized for fast upload.
    static func dataURL(maxLongSide: Int = 1440) async throws -> String {
        let image = try await captureImage(maxLongSide: maxLongSide)
        let rep = NSBitmapImageRep(cgImage: image)
        guard let jpg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7]) else {
            throw HelperError(message: "Could not encode screenshot.")
        }
        return "data:image/jpeg;base64," + jpg.base64EncodedString()
    }

    /// Tiny grayscale thumbnail (32x18) used to detect when the screen changes.
    static func fingerprint() async throws -> [UInt8] {
        let img = try await captureImage(maxLongSide: 320)
        let w = 32, h = 18
        var px = [UInt8](repeating: 0, count: w * h)
        let ok = px.withUnsafeMutableBytes { buf -> Bool in
            guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
            else { return false }
            ctx.interpolationQuality = .medium
            ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        return ok ? px : []
    }

    static func captureImage(maxLongSide: Int) async throws -> CGImage {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)

        let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main
        let displayID = screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID
        guard let display = content.displays.first(where: { $0.displayID == displayID }) ?? content.displays.first else {
            throw HelperError(message: "No display available to capture. Grant Screen Recording permission in System Settings.")
        }

        let mine = content.applications.filter { excludedPIDs.contains($0.processID) }
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
