import AppKit
import SwiftUI

// MARK: - Glass

/// See-through slate glass: faint blur + translucent tint.
struct Glass: View {
    var opacity: Double
    var body: some View {
        ZStack {
            BlurView()
            Color(red: 0.16, green: 0.21, blue: 0.27).opacity(opacity)
        }
    }
}

struct BlurView: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView()
        v.material = .hudWindow
        v.blendingMode = .behindWindow
        v.state = .active
        v.appearance = NSAppearance(named: .darkAqua)
        v.alphaValue = 0.25
        return v
    }
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}

// MARK: - Small components

struct IconButton: View {
    let systemName: String
    var active = false
    var activeColor: Color = .white
    let help: String
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 16, weight: .regular))
                .foregroundStyle(active ? activeColor : .white.opacity(hover ? 1 : 0.8))
                .frame(width: 34, height: 30)
                .background(RoundedRectangle(cornerRadius: 8).fill(.white.opacity(hover ? 0.1 : 0)))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(help)
    }
}

struct Key: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.white.opacity(0.85))
            .frame(minWidth: 26, minHeight: 26)
            .padding(.horizontal, 2)
            .background(RoundedRectangle(cornerRadius: 7).fill(.white.opacity(0.12)))
    }
}

struct Plain<Label: View>: View {
    let action: () -> Void
    @ViewBuilder let label: () -> Label
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) { label() }
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(Capsule().fill(.white.opacity(hover ? 0.1 : 0)))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

// MARK: - Overlay

struct OverlayView: View {
    @ObservedObject var state: AppState
    @FocusState private var inputFocused: Bool

    private var cardVisible: Bool {
        state.cardOpen || state.loggedIn == false || state.isThinking || !state.exchanges.isEmpty
            || state.errorText != nil || state.showTranscript
    }

    var body: some View {
        VStack(spacing: 8) {
            if cardVisible { card } else { pill }
        }
        .padding(8)
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
        .animation(.easeOut(duration: 0.12), value: cardVisible)
        .onChange(of: state.focusInput) {
            state.cardOpen = true
            DispatchQueue.main.async { inputFocused = true }
        }
    }

    // MARK: Collapsed pill

    private var pill: some View {
        HStack(spacing: 0) {
            Plain(action: state.ask) {
                Text("Ask")
                Text("⌥↩").foregroundStyle(.white.opacity(0.45))
            }
            Plain(action: state.toggleListening) {
                Circle().fill(state.isListening ? Color.red : .white.opacity(0.35)).frame(width: 6, height: 6)
                Text(state.isListening ? "Listening" : "Listen")
            }
            Plain(action: { state.togglePanel?() }) {
                Image(systemName: "eye.slash").font(.system(size: 11)).foregroundStyle(.white.opacity(0.6))
            }
        }
        .font(.system(size: 12.5, weight: .medium))
        .padding(3)
        .background(Glass(opacity: state.glassOpacity))
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.08), lineWidth: 0.5))
        .fixedSize()
    }

    // MARK: Expanded card

    private var card: some View {
        VStack(spacing: 0) {
            header
            content
            chips
            footer
        }
        .frame(width: 700)
        .background(Glass(opacity: state.glassOpacity))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(.white.opacity(0.08), lineWidth: 0.5))
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button { state.cardOpen = false; if state.exchanges.isEmpty { state.showTranscript = false } } label: {
                Image(systemName: "arrow.left")
                    .font(.system(size: 15, weight: .medium))
                    .frame(width: 40, height: 40)
                    .background(RoundedRectangle(cornerRadius: 12).fill(.white.opacity(0.1)))
            }
            .buttonStyle(.plain)
            .help("Collapse")

            TextField("", text: $state.question,
                      prompt: Text(state.exchanges.isEmpty ? "Ask about your screen" : "Ask follow-up")
                        .foregroundStyle(.white.opacity(0.5)))
                .textFieldStyle(.plain)
                .font(.system(size: 17))
                .focused($inputFocused)
                .onSubmit(state.ask)

            Button(action: state.ask) {
                Image(systemName: "return")
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 34, height: 34)
                    .background(RoundedRectangle(cornerRadius: 9).fill(.white.opacity(0.2)))
            }
            .buttonStyle(.plain)
            .help("Send (↩)")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.white.opacity(0.1))
    }

    private var content: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !state.directSignedIn {
                        Button(action: state.login) {
                            Text(state.signingIn ? "Waiting for browser…" : "Sign in with ChatGPT →")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(Color(red: 0.6, green: 0.76, blue: 1))
                        }
                        .buttonStyle(.plain)
                    }

                    if state.isListening && !state.showTranscript { liveStrip }

                    ForEach(state.exchanges) { e in exchangeView(e) }

                    if state.isThinking {
                        Text(state.status)
                            .font(.system(size: 14))
                            .foregroundStyle(.white.opacity(0.5))
                    }

                    if let err = state.errorText {
                        Text(err)
                            .font(.system(size: 13))
                            .foregroundStyle(Color(red: 1, green: 0.75, blue: 0.5))
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }

                    if state.showTranscript { transcript }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 18)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.never)
            .frame(height: 380)
            .onChange(of: state.exchanges.count) { withAnimation { proxy.scrollTo("end") } }
            .onChange(of: state.isThinking) { withAnimation { proxy.scrollTo("end") } }
        }
    }

    private func exchangeView(_ e: Exchange) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Spacer(minLength: 80)
                Text(e.ask)
                    .font(.system(size: 15, weight: .medium))
                    .padding(.horizontal, 18).padding(.vertical, 11)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(e.isPreset ? Color(red: 0.13, green: 0.3, blue: 0.75).opacity(0.9) : Color.white.opacity(0.14)))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.white.opacity(0.12), lineWidth: 0.5))
                    .shadow(color: .black.opacity(0.2), radius: 3, y: 1)
                    .textSelection(.enabled)
            }
            if let answer = e.answer {
                Text(state.isListening || !state.lines.isEmpty ? "Viewed screen · Heard conversation" : "Viewed screen")
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.5))
                Text(markdown(answer))
                    .font(.system(size: 15.5))
                    .lineSpacing(5)
                    .foregroundStyle(.white.opacity(0.95))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(answer, forType: .string)
                } label: {
                    Image(systemName: "doc.on.doc").font(.system(size: 13)).foregroundStyle(.white.opacity(0.55))
                }
                .buttonStyle(.plain)
                .help("Copy")
            }
        }
    }

    private var transcript: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Transcript").font(.system(size: 13)).foregroundStyle(.white.opacity(0.5))
            if state.lines.isEmpty && state.partialMe.isEmpty && state.partialThem.isEmpty {
                Text(state.isListening ? "Listening…" : "Not listening. Click the waveform to start.")
                    .font(.system(size: 13)).foregroundStyle(.white.opacity(0.4))
            }
            ForEach(state.lines.suffix(30)) { line in lineView(line.speaker, line.text, final: true) }
            if !state.partialThem.isEmpty { lineView(.them, state.partialThem, final: false) }
            if !state.partialMe.isEmpty { lineView(.me, state.partialMe, final: false) }
        }
        .font(.system(size: 13))
    }

    private func lineView(_ speaker: Speaker, _ text: String, final: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(speaker.label).foregroundStyle(.white.opacity(0.45))
            Text(text).foregroundStyle(.white.opacity(final ? 0.9 : 0.55))
        }
    }

    private var liveStrip: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle().fill(Color.red).frame(width: 6, height: 6)
                Text("Listening").font(.system(size: 12, weight: .medium)).foregroundStyle(.white.opacity(0.6))
                if state.autoAnswer {
                    Text("· auto-answer on").font(.system(size: 12)).foregroundStyle(.white.opacity(0.4))
                }
            }
            let recent = Array(state.lines.suffix(2))
            ForEach(recent) { line in lineView(line.speaker, line.text, final: true) }
            if !state.partialThem.isEmpty { lineView(.them, state.partialThem, final: false) }
            if !state.partialMe.isEmpty { lineView(.me, state.partialMe, final: false) }
            if recent.isEmpty && state.partialThem.isEmpty && state.partialMe.isEmpty {
                Text("Waiting for speech…").font(.system(size: 13)).foregroundStyle(.white.opacity(0.4))
            }
        }
        .font(.system(size: 13))
        .lineLimit(2)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(.white.opacity(0.06)))
    }

    private var chips: some View {
        HStack(spacing: 8) {
            ForEach(Preset.allCases, id: \.self) { p in
                Button { state.ask(p) } label: {
                    Text(p.rawValue)
                        .font(.system(size: 13, weight: .medium))
                        .padding(.horizontal, 14).padding(.vertical, 7)
                        .background(Capsule().fill(p == .whatToSay
                            ? Color(red: 0.13, green: 0.3, blue: 0.75).opacity(0.9) : Color.white.opacity(0.1)))
                        .overlay(Capsule().strokeBorder(.white.opacity(0.12), lineWidth: 0.5))
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.top, 4)
    }

    private var footer: some View {
        ZStack {
            HStack {
                Spacer()
                Button(action: state.reset) {
                    HStack(spacing: 6) {
                        Text("New Chat").font(.system(size: 14, weight: .medium)).foregroundStyle(.white.opacity(0.85))
                        Key(text: "⌥")
                        Key(text: "R")
                    }
                }
                .buttonStyle(.plain)
            }
            HStack(spacing: 4) {
                IconButton(systemName: "square.grid.2x2.fill", active: state.showTranscript,
                           help: "Transcript") { state.showTranscript.toggle() }
                IconButton(systemName: "waveform", active: state.isListening, activeColor: .red,
                           help: "Listen (⌥M)", action: state.toggleListening)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    private func markdown(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(s)
    }
}
