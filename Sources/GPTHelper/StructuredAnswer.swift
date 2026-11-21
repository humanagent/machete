import AppKit
import SwiftUI

// MARK: - Model

/// An answer split into glanceable parts. The model writes simple line prefixes
/// (HINT:, NEXT:, SAY:, NODE:, EDGE:, FOCUS:, SUGGEST:) so it can be parsed while streaming.
/// Anything else (prose, code blocks) is the free-form `body`.
struct StructuredAnswer {
    struct Hint: Hashable { var title: String; var detail: String }
    struct Node: Hashable { var id: String; var label: String; var detail: String }
    struct Edge: Hashable { var from: String; var to: String; var label: String }

    var hints: [Hint] = []
    var next: String?
    var say: String?
    var nodes: [Node] = []
    var edges: [Edge] = []
    var focusID: String?
    var stage: String?
    var focusWhy: String?
    var suggestions: [String] = []
    var body: String = ""

    var hasStructure: Bool { !hints.isEmpty || next != nil || say != nil || !nodes.isEmpty || stage != nil }
    var isEmpty: Bool { !hasStructure && body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// Plain text version (for copy).
    var plainText: String {
        var out: [String] = []
        for (i, h) in hints.enumerated() { out.append("\(i + 1). \(h.title)\(h.detail.isEmpty ? "" : " — \(h.detail)")") }
        if let next { out.append("Next: \(next)") }
        if let say { out.append("\n\(say)") }
        if !body.isEmpty { out.append("\n\(body)") }
        return out.joined(separator: "\n")
    }

    static func parse(_ raw: String, streaming: Bool = false) -> StructuredAnswer {
        var a = StructuredAnswer()
        var lines = raw.components(separatedBy: "\n")
        // While streaming, hold back an unfinished last line so "HIN…" never flashes as body text.
        if streaming, !raw.hasSuffix("\n"), !lines.isEmpty { lines.removeLast() }

        var bodyLines: [String] = []
        var inCode = false
        for line in lines {
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("```") { inCode.toggle(); bodyLines.append(line); continue }
            if inCode { bodyLines.append(line); continue }

            let cleaned = t.replacingOccurrences(of: "**", with: "")
                .trimmingCharacters(in: CharacterSet(charactersIn: "-•* "))
            guard let colon = cleaned.firstIndex(of: ":") else { bodyLines.append(line); continue }
            let key = cleaned[..<colon].uppercased()
            let value = cleaned[cleaned.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            switch key {
            case "HINT":
                let p = split2(value)
                if !p.0.isEmpty { a.hints.append(Hint(title: p.0, detail: p.1)) }
            case "NEXT":
                if !value.isEmpty { a.next = value }
            case "SAY":
                if !value.isEmpty { a.say = (a.say.map { $0 + " " } ?? "") + value }
            case "NODE":
                let parts = value.split(separator: "|", omittingEmptySubsequences: false)
                    .map { $0.trimmingCharacters(in: .whitespaces) }
                if let id = parts.first, !id.isEmpty {
                    a.nodes.append(Node(id: id.lowercased(), label: parts.count > 1 ? parts[1] : id,
                                        detail: parts.count > 2 ? parts[2] : ""))
                }
            case "EDGE":
                let p = split2(value)
                let ends = p.0.replacingOccurrences(of: "→", with: "->").components(separatedBy: "->")
                    .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
                if ends.count == 2, !ends[0].isEmpty, !ends[1].isEmpty {
                    a.edges.append(Edge(from: ends[0], to: ends[1], label: clip(p.1, 18)))
                }
            case "FOCUS":
                let p = split2(value)
                if !p.0.isEmpty { a.focusID = p.0.lowercased(); a.focusWhy = p.1.isEmpty ? nil : p.1 }
            case "STAGE":
                if !value.isEmpty { a.stage = value }
            case "SUGGEST":
                if !value.isEmpty && a.suggestions.count < 3 { a.suggestions.append(value) }
            default:
                bodyLines.append(line)
            }
        }
        a.body = bodyLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        // Edges may name nodes that were never declared: add them so the diagram stays whole.
        for e in a.edges {
            for id in [e.from, e.to] where !a.nodes.contains(where: { $0.id == id }) {
                a.nodes.append(Node(id: id, label: id.capitalized, detail: ""))
            }
        }
        return a
    }

    private static func clip(_ s: String, _ n: Int) -> String {
        s.count <= n ? s : String(s.prefix(n - 1)).trimmingCharacters(in: .whitespaces) + "…"
    }

    private static func split2(_ s: String) -> (String, String) {
        guard let bar = s.firstIndex(of: "|") else { return (s.trimmingCharacters(in: .whitespaces), "") }
        return (s[..<bar].trimmingCharacters(in: .whitespaces),
                s[s.index(after: bar)...].trimmingCharacters(in: .whitespaces))
    }
}

// MARK: - Views

private let accent = Color(red: 0.18, green: 0.36, blue: 0.83)
private let accentSoft = Color(red: 0.5, green: 0.69, blue: 1.0)

struct AnswerView: View {
    let answer: StructuredAnswer
    @State private var showSay = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let stage = answer.stage { StageRail(current: stage) }
            if !answer.nodes.isEmpty {
                DiagramView(nodes: answer.nodes, edges: answer.edges, focusID: answer.focusID)
                if let why = answer.focusWhy, let node = answer.nodes.first(where: { $0.id == answer.focusID }) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("WHY \(node.label.uppercased())")
                            .font(.system(size: 11, weight: .bold)).tracking(0.8).foregroundStyle(accentSoft)
                        Text(inlineMarkdown(why)).font(.system(size: 14.5)).foregroundStyle(.white.opacity(0.95))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12).fill(accentSoft.opacity(0.12)))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(accentSoft.opacity(0.3)))
                }
            }

            ForEach(Array(answer.hints.enumerated()), id: \.offset) { i, h in
                HintCard(index: i + 1, hint: h, primary: i == 0 && answer.nodes.isEmpty)
            }

            if let next = answer.next {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "lightbulb").foregroundStyle(Color(red: 1, green: 0.78, blue: 0.47))
                    Text("Next: ").font(.system(size: 15, weight: .semibold)) + Text(inlineMarkdown(next)).font(.system(size: 15, weight: .semibold))
                }
                .foregroundStyle(Color(red: 1, green: 0.85, blue: 0.64))
                .padding(.horizontal, 12).padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color(red: 1, green: 0.78, blue: 0.47).opacity(0.08)))
                .overlay(RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(Color(red: 1, green: 0.78, blue: 0.47).opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            }

            if let say = answer.say {
                if answer.hasStructure && (answer.hints.count > 0 || !answer.nodes.isEmpty) {
                    Button { showSay.toggle() } label: {
                        Label(showSay ? "Hide full sentence" : "Full sentence", systemImage: showSay ? "chevron.up" : "quote.opening")
                            .font(.system(size: 12, weight: .medium))
                            .padding(.horizontal, 11).padding(.vertical, 6)
                            .background(Capsule().fill(.white.opacity(0.12)))
                    }
                    .buttonStyle(.plain)
                    if showSay { sayText(say) }
                } else {
                    sayText(say)
                }
            }

            if !answer.body.isEmpty { BodyView(text: answer.body) }
        }
    }

    private func sayText(_ s: String) -> some View {
        Text(inlineMarkdown("“\(s)”"))
            .font(.system(size: 15)).lineSpacing(4)
            .foregroundStyle(.white.opacity(0.95))
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// The system design delivery framework, with the current step highlighted.
struct StageRail: View {
    let current: String
    static let steps: [(name: String, short: String, mins: String)] = [
        ("Requirements", "Reqs", "5m"), ("Core Entities", "Entities", "2m"), ("API", "API", "5m"),
        ("Data Flow", "Flow", "opt"), ("High-Level Design", "Design", "10-15m"), ("Deep Dives", "Deep dives", "10m"),
    ]

    private var index: Int? {
        let c = current.lowercased()
        return Self.steps.firstIndex { c.contains($0.name.lowercased()) || c.contains($0.short.lowercased()) }
            ?? (c.contains("high") || c.contains("design") && !c.contains("deep") ? 4 : nil)
    }

    var body: some View {
        let idx = index
        HStack(spacing: 4) {
            ForEach(Array(Self.steps.enumerated()), id: \.offset) { i, step in
                let isCurrent = i == idx
                let done = idx.map { i < $0 } ?? false
                VStack(spacing: 1) {
                    Text(step.short)
                        .font(.system(size: 11.5, weight: isCurrent ? .bold : .medium))
                        .lineLimit(1)
                    Text(step.mins).font(.system(size: 9.5)).opacity(0.7)
                }
                .foregroundStyle(isCurrent ? Color.white : Color.white.opacity(done ? 0.55 : 0.4))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 5)
                .background(RoundedRectangle(cornerRadius: 7)
                    .fill(isCurrent ? accent : Color.white.opacity(done ? 0.1 : 0.05)))
            }
        }
        .accessibilityLabel("Step: \(current)")
    }
}

struct HintCard: View {
    let index: Int
    let hint: StructuredAnswer.Hint
    let primary: Bool

    var body: some View {
        HStack(spacing: 14) {
            Text("\(index)")
                .font(.system(size: 16, weight: .heavy))
                .frame(width: 34, height: 34)
                .background(RoundedRectangle(cornerRadius: 10).fill(primary ? accent : Color.white.opacity(0.14)))
            VStack(alignment: .leading, spacing: 2) {
                Text(hint.title)
                    .font(.system(size: 25, weight: .heavy))
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                if !hint.detail.isEmpty {
                    Text(inlineMarkdown(hint.detail))
                        .font(.system(size: 13))
                        .foregroundStyle(Color(red: 0.73, green: 0.77, blue: 0.83))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 12).fill(primary ? accentSoft.opacity(0.16) : Color.white.opacity(0.07)))
        .textSelection(.enabled)
    }
}

/// Prose and fenced code blocks.
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
                        .font(.system(size: 14.5)).lineSpacing(4)
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

// MARK: - Diagram

struct DiagramView: View {
    let nodes: [StructuredAnswer.Node]
    let edges: [StructuredAnswer.Edge]
    let focusID: String?

    private let nodeW: CGFloat = 124, nodeH: CGFloat = 50, colGap: CGFloat = 78, rowGap: CGFloat = 18, pad: CGFloat = 14

    /// A "map" (one hub connected to everything else) is laid out radially instead of in columns.
    private var hubID: String? {
        guard nodes.count >= 5, !edges.isEmpty else { return nil }
        var degree: [String: Int] = [:]
        for e in edges { degree[e.from, default: 0] += 1; degree[e.to, default: 0] += 1 }
        guard let hub = degree.max(by: { $0.value < $1.value })?.key else { return nil }
        return edges.allSatisfy({ $0.from == hub || $0.to == hub }) ? hub : nil
    }

    /// Top-left corner of each box for a radial "map": hub in the middle, spokes on an ellipse.
    private var radialPositions: [String: CGPoint]? {
        guard let hub = hubID else { return nil }
        let spokes = nodes.filter { $0.id != hub }
        let rx: CGFloat = 230, ry: CGFloat = CGFloat(min(150, 40 + spokes.count * 18))
        let cx = pad + nodeW / 2 + rx, cy = pad + nodeH / 2 + ry
        var centers: [String: CGPoint] = [hub: CGPoint(x: cx, y: cy)]
        for (i, n) in spokes.enumerated() {
            let angle = -Double.pi / 2 + 2 * Double.pi * Double(i) / Double(spokes.count)
            centers[n.id] = CGPoint(x: cx + rx * CGFloat(cos(angle)), y: cy + ry * CGFloat(sin(angle)))
        }
        return centers.mapValues { CGPoint(x: $0.x - nodeW / 2, y: $0.y - nodeH / 2) }
    }

    private var positions: [String: CGPoint] {
        if let r = radialPositions { return r }
        // Layer = longest path from a source (left to right); cycles are capped.
        // Only "forward" edges (to a node declared later) shape the layout; return arrows
        // (e.g. "302 back to the client") are drawn but never create a cycle.
        let order = Dictionary(uniqueKeysWithValues: nodes.enumerated().map { ($1.id, $0) })
        let forward = edges.filter { (order[$0.from] ?? 0) < (order[$0.to] ?? 0) }
        var layer: [String: Int] = [:]
        for n in nodes { layer[n.id] = 0 }
        for _ in 0..<nodes.count {
            var changed = false
            for e in forward {
                let want = (layer[e.from] ?? 0) + 1
                if want > (layer[e.to] ?? 0), want < nodes.count { layer[e.to] = want; changed = true }
            }
            if !changed { break }
        }
        var columns: [Int: [String]] = [:]
        for n in nodes { columns[layer[n.id] ?? 0, default: []].append(n.id) }
        let maxRows = columns.values.map(\.count).max() ?? 1
        let totalH = CGFloat(maxRows) * nodeH + CGFloat(maxRows - 1) * rowGap
        var pos: [String: CGPoint] = [:]
        for (col, ids) in columns {
            let colH = CGFloat(ids.count) * nodeH + CGFloat(ids.count - 1) * rowGap
            let top = (totalH - colH) / 2
            for (row, id) in ids.enumerated() {
                pos[id] = CGPoint(x: pad + CGFloat(col) * (nodeW + colGap),
                                  y: pad + top + CGFloat(row) * (nodeH + rowGap))
            }
        }
        return pos
    }

    private var size: CGSize {
        let p = positions.values
        let hasBack = hubID == nil && edges.contains { e in
            guard let a = positions[e.from], let b = positions[e.to] else { return false }
            return b.x <= a.x
        }
        return CGSize(width: (p.map(\.x).max() ?? 0) + nodeW + pad,
                      height: (p.map(\.y).max() ?? 0) + nodeH + pad + (hasBack ? 34 : 0))
    }

    var body: some View {
        let pos = positions
        let sz = size
        let radial = hubID != nil
        // Scale the whole diagram down to fit the card width (never up).
        GeometryReader { geo in
            let scale = min(1, geo.size.width / sz.width)
            ZStack(alignment: .topLeading) {
                Canvas { ctx, _ in
                    var labels: [(String, CGPoint, Bool)] = []
                    for e in edges {
                        guard let a = pos[e.from], let b = pos[e.to] else { continue }
                        let hot = e.from == focusID || e.to == focusID
                        let color = hot ? accentSoft : Color.white.opacity(0.45)
                        var path = Path()
                        let end: CGPoint
                        let angle: Double
                        let labelAt: CGPoint
                        if radial {
                            // Straight spoke from box center to the edge of the target box.
                            let ca = CGPoint(x: a.x + nodeW / 2, y: a.y + nodeH / 2)
                            let cb = CGPoint(x: b.x + nodeW / 2, y: b.y + nodeH / 2)
                            let dx = cb.x - ca.x, dy = cb.y - ca.y
                            let t = min(abs(dx) > 0 ? (nodeW / 2) / abs(dx) : .infinity, abs(dy) > 0 ? (nodeH / 2) / abs(dy) : .infinity)
                            end = CGPoint(x: cb.x - dx * t, y: cb.y - dy * t)
                            let start = CGPoint(x: ca.x + dx * t, y: ca.y + dy * t)
                            path.move(to: start)
                            path.addLine(to: end)
                            angle = atan2(Double(dy), Double(dx))
                            labelAt = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)
                        } else if b.x > a.x {
                            let start = CGPoint(x: a.x + nodeW, y: a.y + nodeH / 2)
                            end = CGPoint(x: b.x, y: b.y + nodeH / 2)
                            let midX = (start.x + end.x) / 2
                            path.move(to: start)
                            path.addCurve(to: end, control1: CGPoint(x: midX, y: start.y), control2: CGPoint(x: midX, y: end.y))
                            angle = 0
                            labelAt = CGPoint(x: midX, y: (start.y + end.y) / 2)
                        } else {
                            // Return arrow: an arc underneath both boxes.
                            let start = CGPoint(x: a.x + nodeW / 2, y: a.y + nodeH)
                            end = CGPoint(x: b.x + nodeW / 2, y: b.y + nodeH)
                            let bottom = max(start.y, end.y) + 30
                            path.move(to: start)
                            path.addCurve(to: end, control1: CGPoint(x: start.x, y: bottom), control2: CGPoint(x: end.x, y: bottom))
                            angle = -Double.pi / 2
                            labelAt = CGPoint(x: (start.x + end.x) / 2, y: bottom - 7)
                        }
                        ctx.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: 1.5, dash: (radial || b.x > a.x) ? [] : [4, 3]))
                        var head = Path()
                        head.move(to: end)
                        head.addLine(to: CGPoint(x: end.x - 7 * cos(angle - 0.45), y: end.y - 7 * sin(angle - 0.45)))
                        head.move(to: end)
                        head.addLine(to: CGPoint(x: end.x - 7 * cos(angle + 0.45), y: end.y - 7 * sin(angle + 0.45)))
                        ctx.stroke(head, with: .color(color), lineWidth: 1.5)
                        if !e.label.isEmpty { labels.append((e.label, labelAt, hot)) }
                    }
                    // Labels last, on a dark tag so they stay readable over lines.
                    for (text, at, hot) in labels {
                        let t = ctx.resolve(Text(text).font(.system(size: 10, weight: .medium))
                            .foregroundColor(hot ? Color(red: 0.8, green: 0.88, blue: 1) : .white.opacity(0.75)))
                        let sz = t.measure(in: CGSize(width: colGap + 40, height: 30))
                        let rect = CGRect(x: at.x - sz.width / 2 - 4, y: at.y - sz.height / 2 - 2, width: sz.width + 8, height: sz.height + 4)
                        ctx.fill(Path(roundedRect: rect, cornerRadius: 4), with: .color(Color(red: 0.12, green: 0.15, blue: 0.2)))
                        ctx.draw(t, in: rect.insetBy(dx: 4, dy: 2))
                    }
                }
                .frame(width: size.width, height: size.height)

                ForEach(nodes, id: \.id) { n in
                    let p = pos[n.id] ?? .zero
                    DiagramNodeBox(node: n, focused: n.id == focusID, width: nodeW, height: nodeH)
                        .offset(x: p.x, y: p.y)
                }
            }
            .frame(width: sz.width, height: sz.height, alignment: .topLeading)
            .scaleEffect(scale, anchor: .topLeading)
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
        .aspectRatio(sz.width / sz.height, contentMode: .fit)
        .frame(maxWidth: sz.width)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 12).fill(.white.opacity(0.04)))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.white.opacity(0.08)))
        .accessibilityLabel("Diagram: " + edges.map { "\($0.from) to \($0.to)" }.joined(separator: ", "))
    }
}

struct DiagramNodeBox: View {
    let node: StructuredAnswer.Node
    let focused: Bool
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10)
        let detailColor: Color = focused ? Color(red: 0.86, green: 0.91, blue: 1) : Color.white.opacity(0.6)
        let fill: Color = focused ? accent.opacity(0.6) : Color.white.opacity(0.1)
        let stroke: Color = focused ? accentSoft : Color.white.opacity(0.08)
        return VStack(spacing: 1) {
            Text(node.label).font(.system(size: 13, weight: focused ? .bold : .semibold)).lineLimit(1)
            if !node.detail.isEmpty {
                Text(node.detail).font(.system(size: 10.5)).foregroundStyle(detailColor).lineLimit(1)
            }
        }
        .minimumScaleFactor(0.75)
        .padding(.horizontal, 6)
        .frame(width: width, height: height)
        .background(shape.fill(fill))
        .background(shape.fill(Color(red: 0.13, green: 0.16, blue: 0.21)))
        .overlay(shape.strokeBorder(stroke, lineWidth: focused ? 2 : 1))
    }
}

func inlineMarkdown(_ s: String) -> AttributedString {
    (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
        ?? AttributedString(s)
}
