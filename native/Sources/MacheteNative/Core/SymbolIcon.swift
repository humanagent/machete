import AppKit

/// Exports an SF Symbol, or an SVG file drawn `pointSize` tall (the menu bar icon), as a template PNG.
enum SymbolIcon {
    static func export(name: String, pointSize: CGFloat, scale: CGFloat, weight: String = "regular", to path: String) throws {
        let w: NSFont.Weight = ["medium": .medium, "semibold": .semibold, "bold": .bold, "light": .light][weight] ?? .regular
        let config = NSImage.SymbolConfiguration(pointSize: pointSize, weight: w)
        guard let base = name.hasSuffix(".svg")
            ? NSImage(contentsOfFile: name)
            : NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(config)
        else { throw HelperError(message: "No SF Symbol or SVG named \(name)") }
        if name.hasSuffix(".svg") {
            base.size = NSSize(width: base.size.width / base.size.height * pointSize, height: pointSize)
        }
        let size = NSSize(width: ceil(base.size.width), height: ceil(base.size.height))
        let px = NSSize(width: size.width * scale, height: size.height * scale)
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(px.width), pixelsHigh: Int(px.height),
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                         colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else {
            throw HelperError(message: "Could not allocate bitmap")
        }
        rep.size = size
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        let tinted = NSImage(size: size, flipped: false) { rect in
            base.draw(in: rect)
            NSColor.black.set()
            rect.fill(using: .sourceAtop)
            return true
        }
        tinted.draw(in: NSRect(origin: .zero, size: size))
        NSGraphicsContext.restoreGraphicsState()
        guard let png = rep.representation(using: .png, properties: [:]) else { throw HelperError(message: "PNG encode failed") }
        try png.write(to: URL(fileURLWithPath: path))
    }
}
