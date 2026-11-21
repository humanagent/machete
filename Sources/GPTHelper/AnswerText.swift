import SwiftUI

/// A plain-text answer: markdown paragraphs, with fenced code blocks rendered as code.
struct BodyView: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(segments.enumerated()), id: \.offset) { _, seg in
                if seg.code {
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(seg.text)
                            .font(.system(size: 12.5, design: .monospaced))
                            .foregroundStyle(.white.opacity(0.92))
                            .textSelection(.enabled)
                            .padding(10)
                    }
                    .background(RoundedRectangle(cornerRadius: 8).fill(.black.opacity(0.35)))
                } else {
                    Text(inlineMarkdown(seg.text))
                        .font(.inter(14.5)).lineSpacing(4)
                        .foregroundStyle(.white.opacity(0.93))
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var segments: [(code: Bool, text: String)] {
        var out: [(Bool, String)] = []
        var cur: [String] = []
        var code = false
        func flush() {
            let s = cur.joined(separator: "\n").trimmingCharacters(in: code ? .newlines : .whitespacesAndNewlines)
            if !s.isEmpty { out.append((code, s)) }
            cur = []
        }
        for line in text.components(separatedBy: "\n") {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") { flush(); code.toggle(); continue }
            cur.append(line)
        }
        flush()
        return out.map { (code: $0.0, text: $0.1) }
    }
}

func inlineMarkdown(_ s: String) -> AttributedString {
    (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
        ?? AttributedString(s)
}
