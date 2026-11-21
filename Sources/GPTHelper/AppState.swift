import AppKit
import Foundation

enum Speaker: String {
    case me, them
    var label: String { self == .me ? "Me" : "Them" }
}

struct TranscriptLine: Identifiable {
    let id = UUID()
    let speaker: Speaker
    let text: String
}

struct Exchange: Identifiable {
    let id = UUID()
    let ask: String          // label shown in the bubble
    let typed: String        // instruction sent to the model
    var isPreset = false
    var answer: String?
}

enum Preset: String, CaseIterable {
    case whatToSay = "What should I say?"
    case followUps = "Follow-up questions"
    case recap = "Recap"

    var instruction: String {
        switch self {
        case .whatToSay:
            return "Based on the conversation so far (especially the last thing \"Them\" said), tell me exactly what to say next. Write it in first person, ready to say out loud: 2-4 natural sentences. Then, only if useful, up to 3 short bullets of key points or numbers to mention. If there is code or a problem on screen that they asked about, include the solution."
        case .followUps:
            return "Suggest 3 sharp, specific follow-up questions I could ask right now, based on the conversation."
        case .recap:
            return "Recap the conversation so far in 3-6 bullets: main points, decisions, open questions and action items."
        }
    }
}

@MainActor
final class AppState: ObservableObject {
    static let languages: [(String, String)] = [("en-US", "English"), ("es-ES", "Español")]

    @Published var question = ""
    @Published var exchanges: [Exchange] = []
    @Published var isThinking = false
    @Published var errorText: String?
    @Published var isListening = false
    @Published var showTranscript = false
    @Published var lines: [TranscriptLine] = []
    @Published var partialMe = ""
    @Published var partialThem = ""
    @Published var transcriptTick = 0
    @Published var focusInput = false
    @Published var cardOpen = false
    @Published var status = "Thinking…"
    @Published var loggedIn: Bool? = nil
    @Published var signingIn = false
    @Published var glassOpacity: Double = UserDefaults.standard.object(forKey: "glassOpacity") as? Double ?? 0.55
    @Published var language: String = UserDefaults.standard.string(forKey: "language") ?? "en-US"
    /// Signed in directly with "Sign in with ChatGPT" (fast path). Otherwise falls back to Codex CLI.
    @Published var directSignedIn = false
    @Published var model: String = UserDefaults.standard.string(forKey: "model") ?? "gpt-6.2-sol"
    @Published var models: [(slug: String, name: String)] = [
        ("gpt-6.2-sol", "GPT-6.2-Sol"), ("gpt-6.1-terra", "GPT-6.1 Terra"), ("gpt-6-luna", "GPT-6-Luna"),
    ]

    var togglePanel: (() -> Void)?
    var showPanel: (() -> Void)?

    private let codex = CodexRunner()
    private var transcriber: Transcriber?
    private var askTask: Task<Void, Never>?

    // MARK: Ask

    @Published var autoAnswer: Bool = UserDefaults.standard.object(forKey: "autoAnswer") as? Bool ?? true
    private var autoAnswerTask: Task<Void, Never>?

    func setAutoAnswer(_ on: Bool) {
        autoAnswer = on
        UserDefaults.standard.set(on, forKey: "autoAnswer")
    }

    func ask(_ preset: Preset) { ask(preset: preset) }

    func ask() { ask(preset: nil) }

    func ask(preset: Preset?) {
        showPanel?()
        cardOpen = true
        askTask?.cancel()
        codex.cancel()

        if loggedIn == false {
            errorText = "Sign in with ChatGPT first."
            return
        }

        let typed = preset?.instruction ?? question.trimmingCharacters(in: .whitespacesAndNewlines)
        if preset == nil { question = "" }
        errorText = nil
        isThinking = true
        status = "Capturing screen…"
        exchanges.append(Exchange(ask: preset?.rawValue ?? (typed.isEmpty ? "Assist" : typed), typed: typed,
                                  isPreset: preset != nil))
        let exchangeID = exchanges.last!.id

        askTask = Task { [weak self] in
            guard let self else { return }
            do {
                let captureMsg = "Screen capture timed out. Grant Screen Recording to gpt-helper in System Settings ▸ Privacy & Security, then reopen the app."
                let prompt = self.buildPrompt(question: typed)
                let answer: String
                if self.directSignedIn {
                    let image = try await withTimeout(15, captureMsg) { try await ScreenCapture.captureDataURL() }
                    if Task.isCancelled { return }
                    self.status = "Asking ChatGPT…"
                    let model = self.model
                    answer = try await withTimeout(120, "ChatGPT took too long to answer. Try again.") {
                        try await ResponsesClient.ask(model: model, instructions: Self.instructions, text: prompt,
                                                      imageDataURL: image, effort: "low") { [weak self] partial in
                            guard let self, let i = self.exchanges.firstIndex(where: { $0.id == exchangeID }) else { return }
                            self.exchanges[i].answer = partial
                        }
                    }
                } else {
                    let image = try await withTimeout(15, captureMsg) { try await ScreenCapture.captureScreenUnderMouse() }
                    if Task.isCancelled { return }
                    self.status = "Asking ChatGPT (via Codex)…"
                    let codex = self.codex
                    answer = try await withTimeout(150, "ChatGPT took too long to answer. Try again.", onTimeout: { codex.cancel() }) {
                        try await codex.run(prompt: Self.instructions + "\n\n" + prompt, image: image)
                    }
                    try? FileManager.default.removeItem(at: image)
                }
                if Task.isCancelled { return }
                if let i = self.exchanges.firstIndex(where: { $0.id == exchangeID }) {
                    self.exchanges[i].answer = answer
                }
            } catch is CancellationError {
                if Task.isCancelled { return }
            } catch {
                if Task.isCancelled { return }
                self.errorText = error.localizedDescription
                if let e = error as? SIWCError, e.needsSignIn { self.directSignedIn = false; self.refreshLoggedIn() }
                if error.localizedDescription.contains("sign-in") { self.loggedIn = false }
            }
            self.isThinking = false
            self.exchanges.removeAll { $0.id == exchangeID && ($0.answer ?? "").isEmpty }
        }
    }

    static let instructions = """
    You are gpt-helper, a real-time assistant on the user's Mac. You see a screenshot of their screen and, when available, a live transcript of their conversation.
    - Lead with the answer. Be direct and concise; short bullets over paragraphs.
    - For code, give complete working code with a one-line explanation of the approach and its complexity.
    - Reply in the language of the conversation (or of the user's question).
    - Do not run commands or use tools. Just answer from the screenshot and transcript.
    """

    func setModel(_ slug: String) {
        model = slug
        UserDefaults.standard.set(slug, forKey: "model")
    }

    func setGlassOpacity(_ v: Double) {
        glassOpacity = v
        UserDefaults.standard.set(v, forKey: "glassOpacity")
    }

    private func buildPrompt(question: String) -> String {
        let recent = lines.suffix(60).map { "\($0.speaker.label): \($0.text)" }
        var transcript = recent
        if !partialThem.isEmpty { transcript.append("Them: \(partialThem)") }
        if !partialMe.isEmpty { transcript.append("Me: \(partialMe)") }

        let task = question.isEmpty
            ? "Figure out what I most likely need right now and give it to me. If someone just asked a question in the conversation, answer it as I should. If there is a problem, question or code on screen, solve it."
            : question

        let history = exchanges.dropLast().suffix(4).compactMap { e -> String? in
            guard let a = e.answer else { return nil }
            return "Me: \(e.typed.isEmpty ? "(asked for help with the screen)" : e.typed)\nYou: \(a)"
        }

        return """
        Attached is a screenshot of my screen right now.
        \(transcript.isEmpty ? "" : "Live transcript of the current conversation (\"Me\" = my microphone, \"Them\" = the other people / computer audio):\n<transcript>\n\(transcript.joined(separator: "\n"))\n</transcript>\n")
        \(history.isEmpty ? "" : "Earlier in this chat:\n<history>\n\(history.joined(separator: "\n\n"))\n</history>\n")
        Task: \(task)
        """
    }

    func reset() {
        askTask?.cancel()
        codex.cancel()
        isThinking = false
        exchanges = []
        errorText = nil
        cardOpen = false
        lines = []
        partialMe = ""
        partialThem = ""
    }

    // MARK: Listening

    func toggleListening() {
        isListening ? stopListening() : startListening()
    }

    func startListening() {
        errorText = nil
        let t = Transcriber(locale: Locale(identifier: language))
        t.onPartial = { [weak self] speaker, text in
            guard let self else { return }
            if speaker == .me { self.partialMe = text } else { self.partialThem = text }
            self.transcriptTick += 1
        }
        t.onCommit = { [weak self] speaker, text in
            guard let self else { return }
            self.lines.append(TranscriptLine(speaker: speaker, text: text))
            if self.lines.count > 400 { self.lines.removeFirst(self.lines.count - 400) }
            self.transcriptTick += 1
            if speaker == .them { self.scheduleAutoAnswer() }
            else { self.autoAnswerTask?.cancel() } // I started talking: don't interrupt
        }
        t.onError = { [weak self] message in self?.errorText = message }
        transcriber = t
        isListening = true
        showTranscript = true
        Task {
            do { try await t.start() } catch {
                self.errorText = error.localizedDescription
                self.stopListening()
            }
        }
    }

    /// When the other side finishes a question, prepare what to say.
    private func scheduleAutoAnswer() {
        autoAnswerTask?.cancel()
        guard autoAnswer else { return }
        autoAnswerTask = Task { [weak self] in
            // Wait for them to finish (multi-sentence questions arrive as several lines).
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            guard let self, !Task.isCancelled, !self.isThinking, self.partialThem.isEmpty else { return }
            let recent = self.lines.suffix(3).filter { $0.speaker == .them }.map(\.text).joined(separator: " ")
            guard Self.looksLikeQuestion(recent) else { return }
            self.ask(.whatToSay)
        }
    }

    static func looksLikeQuestion(_ text: String) -> Bool {
        let t = text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if t.contains("?") { return true }
        let starters = ["what", "why", "how", "when", "where", "who", "which", "can you", "could you", "would you",
                        "tell me", "walk me", "explain", "describe", "do you", "have you", "are you", "is there",
                        "qué", "que ", "por qué", "cómo", "como ", "cuándo", "dónde", "quién", "cuál", "contame",
                        "explicame", "podés", "podrías", "tenés", "sabés"]
        let lastSentence = t.split(whereSeparator: { ".!".contains($0) }).last.map(String.init) ?? t
        return starters.contains { lastSentence.trimmingCharacters(in: .whitespaces).hasPrefix($0) }
    }

    func stopListening() {
        autoAnswerTask?.cancel()
        transcriber?.stop()
        transcriber = nil
        isListening = false
        partialMe = ""
        partialThem = ""
    }

    func setLanguage(_ code: String) {
        language = code
        UserDefaults.standard.set(code, forKey: "language")
        if isListening { stopListening(); startListening() }
    }

    // MARK: Auth

    func checkLogin() {
        Task {
            self.directSignedIn = await SIWCAuth.shared.isSignedIn
            if self.directSignedIn { self.loadModels() }
            await self.refreshLoggedInAsync()
        }
    }

    private func refreshLoggedIn() { Task { await refreshLoggedInAsync() } }

    private func refreshLoggedInAsync() async {
        if directSignedIn { loggedIn = true; return }
        let codexOK = await codex.isLoggedIn()
        loggedIn = codexOK ? true : false
        if !codexOK { cardOpen = true }
    }

    /// Sign in with ChatGPT (direct, fast path).
    func login() {
        guard !signingIn else { return }
        signingIn = true
        errorText = nil
        showPanel?()
        Task {
            do {
                try await SIWCAuth.shared.signIn()
                self.directSignedIn = true
                self.loggedIn = true
                self.loadModels()
            } catch {
                self.errorText = error.localizedDescription
            }
            self.signingIn = false
        }
    }

    func signOut() {
        Task {
            await SIWCAuth.shared.signOut()
            self.directSignedIn = false
            await self.refreshLoggedInAsync()
        }
    }

    private func loadModels() {
        Task {
            guard let list = try? await ResponsesClient.listModels(), !list.isEmpty else { return }
            self.models = list
            if !list.contains(where: { $0.slug == self.model }) { self.setModel(list[0].slug) }
        }
    }
}

/// Runs `op`, failing with `message` if it takes longer than `seconds`.
func withTimeout<T>(_ seconds: Double, _ message: String, onTimeout: (() -> Void)? = nil,
                    _ op: @escaping () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await op() }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            onTimeout?()
            throw CodexError(message: message)
        }
        defer { group.cancelAll() }
        return try await group.next()!
    }
}
