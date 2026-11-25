import AppKit
import PDFKit

/// Same extraction as the native app (ContextFiles.swift): notes and documents → plain text.
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
