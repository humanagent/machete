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

/// "Sign in with ChatGPT" button: black-and-white pill with the official ChatGPT logo
/// (asset from developers.openai.com/siwc), matching ChatGPT's own rounded buttons.
struct SignInButton: View {
    let loading: Bool
    let action: () -> Void
    @State private var hover = false

    private static let logo: NSImage? = {
        guard let url = Bundle.main.url(forResource: "chatgpt-logo-black", withExtension: "svg") else { return nil }
        return NSImage(contentsOf: url)
    }()

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if loading {
                    ProgressView().controlSize(.small).tint(.black)
                } else if let logo = Self.logo {
                    Image(nsImage: logo).resizable().interpolation(.high).frame(width: 20, height: 20)
                }
                Text(loading ? "Waiting for browser…" : "Sign in with ChatGPT")
                    .font(.system(size: 15, weight: .medium))
            }
            .foregroundStyle(Color(white: 0.05))
            .padding(.horizontal, 24)
            .frame(height: 44)
            .background(Capsule().fill(Color.white.opacity(hover ? 0.9 : 1)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(loading)
        .onHover { hover = $0 }
    }
}

// MARK: - Overlay

struct OverlayView: View {
    @ObservedObject var state: AppState
    @FocusState private var inputFocused: Bool

    /// The answer card below the bar. Hidden when collapsed (bar only).
    private var cardVisible: Bool {
        if state.collapsed { return false }
        return state.cardOpen || state.loggedIn == false || state.isThinking || !state.exchanges.isEmpty
            || state.errorText != nil || state.showTranscript
    }

    private let barGlass = 0.80

    var body: some View {
        VStack(spacing: 8) {
            bar
            if cardVisible {
                card.frame(height: max(220, state.cardHeight - 60))
            }
        }
        .frame(width: state.cardWidth)
        .padding(8)
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
        .animation(.easeOut(duration: 0.12), value: cardVisible)
        .onAppear { state.cardShowing = cardVisible }
        .onChange(of: cardVisible) { state.cardShowing = cardVisible }
        .onChange(of: state.focusInput) {
            state.collapsed = false
            DispatchQueue.main.async { inputFocused = true }
        }
    }

    // MARK: Command bar

    private var bar: some View {
        HStack(spacing: 8) {
            if state.isListening {
                HStack(spacing: 6) {
                    Circle().fill(state.isPaused ? Color.white.opacity(0.4) : Color(red: 1, green: 0.35, blue: 0.32))
                        .frame(width: 7, height: 7)
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        let secs = state.recordedSeconds(at: ctx.date)
                        Text(String(format: "%d:%02d", secs / 60, secs % 60))
                            .font(.system(size: 12.5, weight: .medium).monospacedDigit())
                            .foregroundStyle(.white.opacity(state.isPaused ? 0.45 : 0.8))
                    }
                }
                Rectangle().fill(.white.opacity(0.16)).frame(width: 1, height: 20)
            }

            TextField("", text: $state.question,
                      prompt: Text(state.exchanges.isEmpty ? "Ask anything…" : "Ask follow-up…")
                        .foregroundStyle(.white.opacity(0.45)))
                .textFieldStyle(.plain)
                .font(.system(size: 16))
                .focused($inputFocused)
                .onSubmit(state.ask)
                .frame(minWidth: 120)

            Button(action: state.ask) {
                Text("⌥ ↩")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.7))
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(RoundedRectangle(cornerRadius: 6).fill(.white.opacity(0.1)))
            }
            .buttonStyle(.plain)
            .help("Ask about the screen")

            IconButton(systemName: state.followMode ? "binoculars.fill" : "binoculars",
                       active: state.followMode, activeColor: Color(red: 0.6, green: 0.76, blue: 1),
                       help: state.followMode ? "Follow is on (click to stop)" : "Follow: suggest ideas automatically",
                       action: state.toggleFollow)
            botsMenu
            IconButton(systemName: state.visibleInCapture ? "eye" : "eye.slash",
                       help: state.visibleInCapture ? "Visible in screen sharing (click to hide)"
                                                    : "Hidden from screen sharing (click to show)",
                       action: state.toggleCaptureVisibility)

            if state.isListening {
                Button(action: state.toggleListening) {
                    RoundedRectangle(cornerRadius: 2.5).fill(Color(white: 0.1))
                        .frame(width: 10, height: 10)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(.white.opacity(0.92)))
                }
                .buttonStyle(.plain)
                .help("Stop recording (⌥M)")
            } else {
                IconButton(systemName: "waveform", help: "Record (⌥M)", action: state.toggleListening)
            }

            Button {
                if cardVisible { state.collapsed = true; state.showTranscript = false }
                else { state.collapsed = false; state.cardOpen = true; state.unseenFollow = 0 }
            } label: {
                Image(systemName: cardVisible ? "chevron.up" : "chevron.down")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white.opacity(0.6))
                    .frame(width: 20, height: 30)
                    .contentShape(Rectangle())
                    .overlay(alignment: .topTrailing) {
                        if !cardVisible && state.unseenFollow > 0 {
                            Circle().fill(Color(red: 0.5, green: 0.69, blue: 1)).frame(width: 7, height: 7).offset(x: 1, y: 4)
                        }
                    }
            }
            .buttonStyle(.plain)
            .help(cardVisible ? "Collapse" : (state.unseenFollow > 0 ? "New Follow suggestions" : "Show answers"))
        }
        .padding(.leading, 16).padding(.trailing, 10)
        .frame(height: 52)
        .background(Glass(opacity: barGlass))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.white.opacity(0.10), lineWidth: 0.5))
    }

    // MARK: Answer card

    private var card: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        if !state.directSignedIn { signInHero }

                        ForEach(state.exchanges) { e in exchangeView(e) }

                        if state.isThinking && (state.exchanges.last?.answer ?? "").isEmpty {
                            HStack(spacing: 8) {
                                ProgressView().controlSize(.small).tint(.white)
                                Text(state.status).font(.system(size: 13.5)).foregroundStyle(.white.opacity(0.55))
                            }
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
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollIndicators(.never)
                .onChange(of: state.exchanges.count) { withAnimation { proxy.scrollTo("end") } }
                .onChange(of: state.isThinking) { withAnimation { proxy.scrollTo("end") } }
            }

            ConversationActions(state: state)
                .padding(.bottom, 12)

            cardFooter
        }
        .background(Glass(opacity: state.glassOpacity))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.white.opacity(0.08), lineWidth: 0.5))
    }

    private var cardFooter: some View {
        HStack(spacing: 12) {
            Text(state.currentProfile.name)
                .font(.system(size: 12))
                .foregroundStyle(.white.opacity(0.45))
            Spacer()
            if !state.lines.isEmpty || state.isListening {
                Button { state.showTranscript.toggle() } label: {
                    Label("Transcript", systemImage: "doc.text")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white.opacity(state.showTranscript ? 1 : 0.65))
                }
                .buttonStyle(.plain)
            }
            if !state.exchanges.isEmpty {
                Button(action: state.reset) {
                    HStack(spacing: 4) {
                        Text("New chat").font(.system(size: 12, weight: .medium))
                        Text("⌥R").font(.system(size: 11)).foregroundStyle(.white.opacity(0.45))
                    }
                    .foregroundStyle(.white.opacity(0.65))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 9)
        .background(Color.white.opacity(0.04))
    }

    private var signInHero: some View {
        VStack(spacing: 14) {
            Text("Connect your ChatGPT plan")
                .font(.system(size: 19, weight: .semibold))
            Text("Answers use your Plus or Pro subscription. No API key needed.")
                .font(.system(size: 13.5))
                .foregroundStyle(.white.opacity(0.55))
            SignInButton(loading: state.signingIn, action: state.login)
                .padding(.top, 6)
            if state.signingIn {
                Text("Finish signing in in your browser…")
                    .font(.system(size: 12.5))
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    private func exchangeView(_ e: Exchange) -> some View {
        let parsed = StructuredAnswer.parse(e.answer ?? "", streaming: !e.done)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                if e.isFollow {
                    Label("Following", systemImage: "binoculars.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color(red: 0.6, green: 0.76, blue: 1))
                } else {
                    Text(e.ask)
                        .font(.system(size: 12.5, weight: .medium))
                        .lineLimit(2)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Capsule().fill(e.isPreset || e.ask == "Assist"
                            ? Color(red: 0.18, green: 0.36, blue: 0.83) : Color.white.opacity(0.14)))
                }
                Text(state.isListening || !state.lines.isEmpty ? "viewed screen · heard conversation" : "viewed screen")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.45))
                Spacer()
                if e.done, let raw = e.answer {
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(parsed.hasStructure ? parsed.plainText : raw, forType: .string)
                    } label: {
                        Image(systemName: "doc.on.doc").font(.system(size: 12)).foregroundStyle(.white.opacity(0.5))
                    }
                    .buttonStyle(.plain)
                    .help("Copy")
                }
            }
            if e.answer != nil { AnswerView(answer: parsed) }
        }
    }

    private var transcript: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("TRANSCRIPT").font(.system(size: 11, weight: .bold)).tracking(0.8).foregroundStyle(.white.opacity(0.45))
            if state.lines.isEmpty {
                Text(state.isListening ? "Recording… the transcript appears when you stop." : "Nothing transcribed yet.")
                    .font(.system(size: 13)).foregroundStyle(.white.opacity(0.4))
            }
            ForEach(state.lines) { line in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(line.speaker.label).foregroundStyle(.white.opacity(0.45))
                    Text(line.text).foregroundStyle(.white.opacity(0.9))
                }
            }
        }
        .font(.system(size: 13))
        .textSelection(.enabled)
    }

    private var botsMenu: some View {
        Menu {
            ForEach(state.profiles) { p in
                Button {
                    state.selectProfile(p.id)
                } label: {
                    if p.id == state.selectedProfileID {
                        Label(p.name, systemImage: "checkmark")
                    } else {
                        Text(p.name)
                    }
                }
            }
            Divider()
            Button {
                state.manageProfiles()
            } label: {
                Label("Manage", systemImage: "square.grid.2x2")
            }
        } label: {
            Image(systemName: "square.grid.2x2")
                .font(.system(size: 15))
                .foregroundStyle(.white.opacity(0.8))
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Bot: \(state.currentProfile.name)")
    }
}
