import AppKit
import PDFKit
import UniformTypeIdentifiers

/// Turns dropped/chosen files (resume, job description, notes) into plain text for a bot's context.
enum ContextFiles {
    static let allowedTypes: [UTType] = [.pdf, .plainText, .text, .rtf, .rtfd, .json, .commaSeparatedText, .html,
                                         UTType(filenameExtension: "md") ?? .plainText,
                                         UTType(filenameExtension: "docx") ?? .data,
                                         UTType(filenameExtension: "doc") ?? .data]

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

    /// "--- resume.pdf ---\n<text>" blocks, ready to append to a context.
    static func block(for url: URL) -> String? {
        guard let raw = text(from: url)?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        return "--- \(url.lastPathComponent) ---\n\(raw)"
    }

    @MainActor
    static func choose() -> [URL] {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = allowedTypes
        panel.message = "Add files to this bot's context"
        return panel.runModal() == .OK ? panel.urls : []
    }
}
