import AppKit
import SwiftUI

// MARK: - Glass

/// See-through slate glass: faint blur + translucent tint.
/// Blurred backdrop plus a neutral tint: the bar is a lighter, more solid gray; the body a darker, see-through gray.
struct Glass: View {
    var opacity: Double
    /// Body: dark slate blue. The menu's transparency setting (0-1) maps to 50-100% tint.
    var tint: Color = Color(red: 0.106, green: 0.149, blue: 0.180)
    var body: some View {
        ZStack {
            BlurView()
            tint.opacity(0.5 + 0.5 * opacity)
        }
    }
}

/// Bottom-edge grip: drags change the panel height; it never moves the window.
struct ResizeGrip: NSViewRepresentable {
    var startHeight: () -> CGFloat
    var onDrag: (CGFloat) -> Void
    var onEnd: () -> Void

    func makeNSView(context: Context) -> GripView { GripView() }
    func updateNSView(_ v: GripView, context: Context) {
        v.startHeight = startHeight; v.onDrag = onDrag; v.onEnd = onEnd
    }

    final class GripView: NSView {
        var startHeight: () -> CGFloat = { 0 }
        var onDrag: (CGFloat) -> Void = { _ in }
        var onEnd: () -> Void = {}
        private var startMouseY: CGFloat = 0
        private var startH: CGFloat = 0

        override var mouseDownCanMoveWindow: Bool { false }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
        override func resetCursorRects() { addCursorRect(bounds, cursor: .resizeUpDown) }

        override func mouseDown(with event: NSEvent) {
            startMouseY = NSEvent.mouseLocation.y
            startH = startHeight()
        }
        override func mouseDragged(with event: NSEvent) {
            // Screen y grows upward: dragging down (smaller y) makes the panel taller.
            onDrag(startH + (startMouseY - NSEvent.mouseLocation.y))
        }
        override func mouseUp(with event: NSEvent) { onEnd() }
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
                .font(.inter(16, weight: .regular))
                .foregroundStyle(active ? activeColor : .white.opacity(hover ? 1 : 0.8))
                .frame(width: 34, height: 30)
                .background(RoundedRectangle(cornerRadius: 9).fill(.white.opacity(hover ? 0.16 : 0.08)))
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
            .font(.inter(13, weight: .medium))
            .foregroundStyle(.white.opacity(0.85))
            .frame(minWidth: 26, minHeight: 26)
            .padding(.horizontal, 2)
            .background(RoundedRectangle(cornerRadius: 7).fill(.white.opacity(0.16)))
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
                    .font(.inter(15, weight: .medium))
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
            || state.errorText != nil || (state.showTranscript && !state.isListening)
    }

    private let barGlass = 0.84          // → 92% tint: lighter and more solid than the body
    private let barTint = Color(red: 0.287, green: 0.345, blue: 0.393)

    var body: some View {
        let bodyH = max(160, state.cardHeight - 66) + 0.5
        // One panel: the bar on top joined to the body below (no separate floating pieces).
        // The body's height animates; the window keeps room for it until a collapse finishes,
        // so opening and closing are smooth instead of the window jumping.
        VStack(spacing: 0) {
            bar
            if bodyMounted {
                VStack(spacing: 0) {
                    Rectangle().fill(.white.opacity(0.08)).frame(height: 0.5)
                    card.frame(height: bodyH - 0.5)
                        .overlay(alignment: .bottom) { resizeHandle }
                }
                .frame(height: bodyOpen ? bodyH : 0, alignment: .top)
                .clipped()
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.white.opacity(0.10), lineWidth: 0.5))
        .frame(height: 58 + (bodyMounted ? bodyH : 0), alignment: .top)
        .frame(width: state.cardWidth)
        .padding(8)
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
        .onAppear {
            state.cardShowing = cardVisible
            bodyMounted = cardVisible; bodyOpen = cardVisible
        }
        .onChange(of: cardVisible) {
            state.cardShowing = cardVisible
            setBody(open: cardVisible)
        }
        .onChange(of: state.focusInput) {
            state.collapsed = false
            DispatchQueue.main.async { inputFocused = true }
        }
    }

    @State private var bodyMounted = false   // window has room for the body
    @State private var bodyOpen = false      // body drawn at full height (animated)
    @State private var bodyGeneration = 0

    private func setBody(open: Bool) {
        bodyGeneration += 1
        let gen = bodyGeneration
        if open {
            bodyMounted = true
            DispatchQueue.main.async { withAnimation(.easeOut(duration: 0.22)) { bodyOpen = true } }
        } else {
            withAnimation(.easeIn(duration: 0.18)) { bodyOpen = false }
            // Give the room back only after the body has slid closed.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                if gen == bodyGeneration { bodyMounted = false }
            }
        }
    }

    // MARK: Command bar

    private var bar: some View {
        HStack(spacing: 8) {
            // Collapse / expand, at the left next to the input (like the reference's back button).
            Button {
                if cardVisible { state.collapsed = true; state.showTranscript = false }
                else { state.collapsed = false; state.cardOpen = true; state.unseenFollow = 0 }
            } label: {
                Image(systemName: cardVisible ? "arrow.left" : "arrow.down")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(.white.opacity(0.9))
                    .frame(width: 40, height: 40)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.white.opacity(0.11)))
                    .contentShape(Rectangle())
                    .overlay(alignment: .topTrailing) {
                        if !cardVisible && state.unseenFollow > 0 {
                            Circle().fill(Color(red: 0.5, green: 0.69, blue: 1)).frame(width: 7, height: 7).offset(x: -3, y: 3)
                        }
                    }
            }
            .buttonStyle(.plain)
            .help(cardVisible ? "Collapse" : (state.unseenFollow > 0 ? "New Follow correction" : "Show answers"))

            if state.isListening {
                HStack(spacing: 6) {
                    Circle().fill(state.isPaused ? Color.white.opacity(0.4) : Color(red: 1, green: 0.35, blue: 0.32))
                        .frame(width: 7, height: 7)
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        let secs = state.recordedSeconds(at: ctx.date)
                        Text(String(format: "%d:%02d", secs / 60, secs % 60))
                            .font(.inter(12.5, weight: .medium).monospacedDigit())
                            .foregroundStyle(.white.opacity(state.isPaused ? 0.45 : 0.8))
                    }
                }
                Rectangle().fill(.white.opacity(0.16)).frame(width: 1, height: 20)
            }

            TextField("", text: $state.question,
                      prompt: Text(state.exchanges.isEmpty ? "Ask a follow-up about the meeting…" : "Ask follow-up…")
                        .foregroundStyle(.white.opacity(0.45)))
                .textFieldStyle(.plain)
                .font(.inter(16))
                .focused($inputFocused)
                .onSubmit(state.ask)
                .frame(minWidth: 120)

            Button(action: state.ask) {
                Text("⌥ ↩")
                    .font(.inter(13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.9))
                    .frame(minWidth: 40, minHeight: 32)
                    .background(RoundedRectangle(cornerRadius: 9).fill(.white.opacity(0.22)))
            }
            .buttonStyle(.plain)
            .help("Ask about the screen")

            IconButton(systemName: state.followMode ? "binoculars.fill" : "binoculars",
                       active: state.followMode, activeColor: Color(red: 0.6, green: 0.76, blue: 1),
                       help: state.followMode ? "Follow is on (click to stop)" : "Follow: flag my mistakes automatically",
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

        }
        .padding(.leading, 10).padding(.trailing, 10)
        .frame(height: 58)
        .background(Glass(opacity: barGlass, tint: barTint))
    }

    /// Grab the bottom edge and drag to make the panel shorter or taller.
    /// AppKit-backed so the drag resizes instead of moving the (movable-by-background) window.
    private var resizeHandle: some View {
        ResizeGrip(
            startHeight: { state.cardHeight },
            onDrag: { h in state.cardHeight = min(1400, max(220, h)) },
            onEnd: { UserDefaults.standard.set(Double(state.cardHeight), forKey: "cardHeight") }
        )
        .frame(height: 10)
        .help("Drag to resize")
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
                                Text(state.status).font(.inter(13.5)).foregroundStyle(.white.opacity(0.55))
                            }
                        }

                        if let err = state.errorText {
                            Text(err)
                                .font(.inter(13))
                                .foregroundStyle(Color(red: 1, green: 0.75, blue: 0.5))
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                        }

                        // Never on screen while recording; it shows once recording stops.
                        if state.showTranscript && !state.isListening { transcript }
                        Color.clear.frame(height: 1).id("end")
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollIndicators(.never)
                .onChange(of: state.exchanges.count) { withAnimation { proxy.scrollTo("end") } }
                .onChange(of: state.isThinking) { withAnimation { proxy.scrollTo("end") } }
            }


            cardFooter
        }
        .background(Glass(opacity: state.glassOpacity))
    }

    private var cardFooter: some View {
        HStack(spacing: 12) {
            Spacer()
            if !state.lines.isEmpty && !state.isListening {
                Button { state.showTranscript.toggle() } label: {
                    Label("Transcript", systemImage: "doc.text")
                        .font(.inter(12, weight: .medium))
                        .foregroundStyle(.white.opacity(state.showTranscript ? 1 : 0.65))
                }
                .buttonStyle(.plain)
            }
            if !state.exchanges.isEmpty {
                Button(action: state.reset) {
                    HStack(spacing: 6) {
                        Text("New Chat").font(.inter(13, weight: .medium)).foregroundStyle(.white.opacity(0.75))
                        Key(text: "⌥")
                        Key(text: "R")
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 9)
    }

    private var signInHero: some View {
        VStack(spacing: 14) {
            Text("Connect your ChatGPT plan")
                .font(.inter(19, weight: .semibold))
            Text("Answers use your Plus or Pro subscription. No API key needed.")
                .font(.inter(13.5))
                .foregroundStyle(.white.opacity(0.55))
            SignInButton(loading: state.signingIn, action: state.login)
                .padding(.top, 6)
            if state.signingIn {
                Text("Finish signing in in your browser…")
                    .font(.inter(12.5))
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    /// What I asked as a bubble on the right ("Assist" when I just pressed enter), then the answer.
    /// Follow corrections have no bubble.
    private func exchangeView(_ e: Exchange) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !e.isFollow {
                HStack {
                    Spacer(minLength: 60)
                    Text(e.ask)
                        .font(.inter(14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.92))
                        .multilineTextAlignment(.leading)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.white.opacity(0.16)))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.white.opacity(0.08), lineWidth: 0.5))
                        .shadow(color: .black.opacity(0.18), radius: 4, y: 2)
                        .textSelection(.enabled)
                }
                .padding(.bottom, 6)
            }
            if let answer = e.answer {
                BodyView(text: answer)
                if e.done {
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(answer, forType: .string)
                    } label: {
                        Image(systemName: "doc.on.doc").font(.inter(12)).foregroundStyle(.white.opacity(0.45))
                    }
                    .buttonStyle(.plain)
                    .help("Copy")
                }
            }
        }
    }

    private var transcript: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("TRANSCRIPT").font(.inter(11, weight: .semibold)).tracking(1.6).foregroundStyle(.white.opacity(0.45))
                Spacer()
                if !state.lines.isEmpty {
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(state.lines.map { "\(Self.clock($0.offset)) \($0.speaker.label): \($0.text)" }
                            .joined(separator: "\n"), forType: .string)
                    } label: {
                        Label("Copy Transcript", systemImage: "doc.on.doc")
                            .font(.inter(12, weight: .medium)).foregroundStyle(.white.opacity(0.6))
                    }
                    .buttonStyle(.plain)
                }
            }
            if state.lines.isEmpty && state.partialMe.isEmpty && state.partialThem.isEmpty {
                Text(state.isListening ? "Listening… words show up here as they're recognized." : "Nothing transcribed yet.")
                    .font(.inter(13)).foregroundStyle(.white.opacity(0.4))
            }
            ForEach(state.lines) { line in
                transcriptRow(time: Self.clock(line.offset), speaker: line.speaker, text: line.text, final: true)
            }
            // Words still being recognized (not final yet).
            ForEach([(Speaker.them, state.partialThem), (Speaker.me, state.partialMe)].filter { !$0.1.isEmpty }, id: \.0.label) { p in
                transcriptRow(time: "", speaker: p.0, text: p.1, final: false)
            }
        }
        .textSelection(.enabled)
    }

    private func transcriptRow(time: String, speaker: Speaker, text: String, final: Bool) -> some View {
        HStack(alignment: .top, spacing: 0) {
            Text(time).font(.inter(11.5).monospacedDigit()).foregroundStyle(.white.opacity(0.4))
                .frame(width: 52, alignment: .leading).padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(speaker.label.uppercased()).font(.inter(10.5, weight: .semibold)).tracking(1.4)
                    .foregroundStyle(.white.opacity(0.45))
                Text(text).font(.inter(14.5)).foregroundStyle(.white.opacity(final ? 0.92 : 0.55))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    static func clock(_ secs: Int) -> String { String(format: "%d:%02d", secs / 60, secs % 60) }

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
                .font(.inter(15))
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
