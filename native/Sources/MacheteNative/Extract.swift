import AppKit
import PDFKit

/// Same extraction as the native app (ContextFiles.swift): resume, job description, notes → plain text.
enum Extract {
    static func text(from url: URL) -> String? {
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "pdf":
            guard let doc = PDFDocument(url: url) else { return nil }
            return doc.string
        case "docx":
            return try? NSAttributedString(url: url, options: [.documentType: NSAttributedString.DocumentType.officeOpenXML],
                                           documentAttributes: nil).string
        case "doc":
            return try? NSAttributedString(url: url, options: [.documentType: NSAttributedString.DocumentType.docFormat],
                                           documentAttributes: nil).string
        case "rtf", "rtfd", "html", "htm":
            return try? NSAttributedString(url: url, options: [:], documentAttributes: nil).string
        default:
            if let s = try? String(contentsOf: url, encoding: .utf8) { return s }
            return try? String(contentsOf: url, encoding: .isoLatin1)
        }
    }
}

/// Exports an SF Symbol as a template PNG (menu bar icon), so the Electron tray matches the native one.
enum SymbolIcon {
    static func export(name: String, pointSize: CGFloat, scale: CGFloat, weight: String = "regular", to path: String) throws {
        let w: NSFont.Weight = ["medium": .medium, "semibold": .semibold, "bold": .bold, "light": .light][weight] ?? .regular
        let config = NSImage.SymbolConfiguration(pointSize: pointSize, weight: w)
        guard let base = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(config) else {
            throw HelperError(message: "No SF Symbol named \(name)")
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
