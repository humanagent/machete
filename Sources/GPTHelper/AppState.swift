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
    var isFollow = false
    var answer: String?
    var suggestions: [String] = []
    var done = false
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
    /// User collapsed the card (← or recording mode). Cleared when a new answer starts.
    @Published var collapsed = false
    @Published var listenStart: Date?      // start of the current (unpaused) segment
    @Published var isPaused = false
    private var recordedBefore: TimeInterval = 0

    func recordedSeconds(at now: Date) -> Int {
        let current = (isPaused || listenStart == nil) ? 0 : now.timeIntervalSince(listenStart!)
        return max(0, Int(recordedBefore + current))
    }

    func togglePause() {
        guard isListening else { return }
        if isPaused {
            listenStart = Date()
            isPaused = false
        } else {
            recordedBefore += Date().timeIntervalSince(listenStart ?? Date())
            isPaused = true
            autoAnswerTask?.cancel()
        }
        transcriber?.setPaused(isPaused)
    }
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

    /// When true the overlay shows up in screenshots / screen sharing like any normal window.
    @Published var visibleInCapture: Bool = UserDefaults.standard.bool(forKey: "visibleInCapture")
    var applyCaptureVisibility: ((Bool) -> Void)?

    func toggleCaptureVisibility() {
        visibleInCapture.toggle()
        UserDefaults.standard.set(visibleInCapture, forKey: "visibleInCapture")
        applyCaptureVisibility?(visibleInCapture)
    }

    /// Expanded card size; the user can drag the window edges to change it (persisted).
    @Published var cardWidth: CGFloat = CGFloat(UserDefaults.standard.object(forKey: "cardWidth") as? Double ?? 640)
    @Published var cardHeight: CGFloat = CGFloat(UserDefaults.standard.object(forKey: "cardHeight") as? Double ?? 560)

    func setCardSize(_ size: CGSize, persist: Bool) {
        cardWidth = max(480, size.width)
        cardHeight = max(300, size.height)
        if persist {
            UserDefaults.standard.set(Double(cardWidth), forKey: "cardWidth")
            UserDefaults.standard.set(Double(cardHeight), forKey: "cardHeight")
        }
    }

    /// Set by the view; the panel is only drag-resizable while the expanded card shows.
    var cardShowing = false { didSet { if cardShowing != oldValue { onCardShowingChanged?(cardShowing) } } }
    var onCardShowingChanged: ((Bool) -> Void)?

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

    /// Send one of the model's auto-generated follow-up suggestions.
    func ask(suggestion: String) {
        if loggedIn == false { errorText = "Sign in with ChatGPT first."; return }
        run(label: suggestion, instruction: suggestion, isPreset: false, isFollow: false)
    }

    /// Suggestions from the most recent answer.
    var currentSuggestions: [String] {
        exchanges.last(where: { $0.answer != nil })?.suggestions ?? []
    }

    func ask() { ask(preset: nil) }

    /// `automatic`: triggered by the app (auto-answer), not by the user, so it never reveals a hidden panel.
    func ask(preset: Preset?, automatic: Bool = false) {
        if automatic && loggedIn == false { return }
        if loggedIn == false {
            showPanel?(); cardOpen = true; collapsed = false
            errorText = "Sign in with ChatGPT first."
            return
        }
        let typed = preset?.instruction ?? question.trimmingCharacters(in: .whitespacesAndNewlines)
        if preset == nil { question = "" }
        run(label: preset?.rawValue ?? (typed.isEmpty ? "Assist" : typed), instruction: typed,
            isPreset: preset != nil, isFollow: false, reveal: !automatic)
    }

    /// Shared request path. Follow-mode requests are quiet: no streaming, dropped if there's nothing new.
    private func run(label: String, instruction: String, isPreset: Bool, isFollow: Bool, reveal: Bool = true) {
        // Only what the user triggers opens the panel; Follow and auto-answer stay quiet.
        let quiet = isFollow || !reveal
        if !quiet {
            showPanel?()
            cardOpen = true
            collapsed = false
        }
        askTask?.cancel()
        codex.cancel()
        errorText = nil
        isThinking = !isFollow
        followBusy = isFollow
        status = "Capturing screen…"

        let prompt = buildPrompt(question: instruction)   // built before adding this exchange
        exchanges.append(Exchange(ask: label, typed: instruction, isPreset: isPreset, isFollow: isFollow))
        let exchangeID = exchanges.last!.id
        let instructions = systemPrompt

        askTask = Task { [weak self] in
            guard let self else { return }
            do {
                let captureMsg = "Screen capture timed out. Grant Screen Recording to gpt-helper in System Settings ▸ Privacy & Security, then reopen the app."
                let answer: String
                if self.directSignedIn {
                    let image = try await withTimeout(15, captureMsg) { try await ScreenCapture.captureDataURL() }
                    if Task.isCancelled { return }
                    self.status = "Asking ChatGPT…"
                    let model = self.model
                    answer = try await withTimeout(120, "ChatGPT took too long to answer. Try again.") {
                        try await ResponsesClient.ask(model: model, instructions: instructions, text: prompt,
                                                      imageDataURL: image, effort: "low") { [weak self] partial in
                            guard !isFollow, let self,
                                  let i = self.exchanges.firstIndex(where: { $0.id == exchangeID }) else { return }
                            self.exchanges[i].answer = partial
                        }
                    }
                } else {
                    let image = try await withTimeout(15, captureMsg) { try await ScreenCapture.captureScreenUnderMouse() }
                    if Task.isCancelled { return }
                    self.status = "Asking ChatGPT (via Codex)…"
                    let codex = self.codex
                    answer = try await withTimeout(150, "ChatGPT took too long to answer. Try again.", onTimeout: { codex.cancel() }) {
                        try await codex.run(prompt: instructions + "\n\n" + prompt, image: image)
                    }
                    try? FileManager.default.removeItem(at: image)
                }
                if Task.isCancelled { return }
                let trimmed = answer.trimmingCharacters(in: .whitespacesAndNewlines)
                if let i = self.exchanges.firstIndex(where: { $0.id == exchangeID }) {
                    let parsed = StructuredAnswer.parse(trimmed)
                    if isFollow && (parsed.isEmpty || (!parsed.hasStructure && parsed.body.uppercased().hasPrefix("NOTHING"))) {
                        self.exchanges.remove(at: i)          // nothing new worth saying
                    } else {
                        self.exchanges[i].answer = answer
                        self.exchanges[i].suggestions = parsed.suggestions
                        // Follow never pops the panel open; it only flags that something new arrived.
                        if quiet && self.collapsed { self.unseenFollow += 1 }
                    }
                }
            } catch is CancellationError {
                if Task.isCancelled { return }
            } catch {
                if Task.isCancelled { return }
                self.errorText = error.localizedDescription
                if isFollow { self.setFollow(false) }      // don't keep hammering on errors / usage limits
                if let e = error as? SIWCError, e.needsSignIn { self.directSignedIn = false; self.refreshLoggedIn() }
                if error.localizedDescription.contains("sign-in") { self.loggedIn = false }
            }
            self.isThinking = false
            self.followBusy = false
            if let i = self.exchanges.firstIndex(where: { $0.id == exchangeID }) { self.exchanges[i].done = true }
            self.exchanges.removeAll { $0.id == exchangeID && ($0.answer ?? "").isEmpty }
        }
    }

    // MARK: Bots (profiles)

    @Published var profiles: [Profile] = ProfileStore.load()
    @Published var selectedProfileID: UUID = {
        if let s = UserDefaults.standard.string(forKey: "profileID"), let id = UUID(uuidString: s) { return id }
        return UUID()
    }()

    var currentProfile: Profile {
        profiles.first { $0.id == selectedProfileID } ?? profiles[0]
    }

    var systemPrompt: String { currentProfile.instructions + "\n\n" + ProfileStore.baseRules }

    func selectProfile(_ id: UUID) {
        selectedProfileID = id
        UserDefaults.standard.set(id.uuidString, forKey: "profileID")
    }

    func saveProfiles() { ProfileStore.save(profiles) }

    func addProfile() -> UUID {
        let p = Profile(name: "New bot", instructions: "You are my real-time assistant for …")
        profiles.append(p)
        saveProfiles()
        return p.id
    }

    func deleteProfile(_ id: UUID) {
        guard profiles.count > 1 else { return }
        profiles.removeAll { $0.id == id }
        if selectedProfileID == id { selectProfile(profiles[0].id) }
        saveProfiles()
    }

    func manageProfiles() { ManageWindowController.shared.show(state: self) }

    // MARK: Follow mode

    @Published var followMode = false
    @Published var followBusy = false
    /// Follow suggestions that arrived while the card was collapsed.
    @Published var unseenFollow = 0
    private var followTask: Task<Void, Never>?
    private var lastFingerprint: [UInt8] = []
    private var lastFollowAt = Date.distantPast
    private var lastFollowLineCount = 0

    static let followInstruction = """
    FOLLOW MODE (error checker): I'm not asking anything; you're watching my screen and conversation continuously.
    Your ONLY job is to catch MY mistakes: things "Me" said in the transcript, or what I wrote/drew on screen (code, design, math, answers).
    A mistake is something factually wrong, a bug, a wrong complexity or number, a design flaw that breaks a requirement, or a misunderstanding of what "Them" asked.
    Do NOT give ideas, next steps, tips, improvements, style nits or answers to questions I haven't attempted yet. Ignore what other people said except to judge whether I understood them.
    If you find a real mistake: no diagram. Reply with 1-2 HINT lines, each: HINT: <what's wrong, max 5 words> | <the correct version, concretely>. Optionally one SAY: line with how to correct it out loud.
    Only flag mistakes you are confident about. Don't repeat a correction you already made earlier in this chat.
    If I made no new mistake, reply with exactly: NOTHING
    This overrides the usual answer format: no NODE/EDGE/FOCUS/NEXT/SUGGEST in follow mode.
    """

    func toggleFollow() { setFollow(!followMode) }

    func setFollow(_ on: Bool) {
        followMode = on
        followTask?.cancel()
        guard on else { return }
        if loggedIn == false { followMode = false; errorText = "Sign in with ChatGPT first."; return }
        lastFingerprint = []
        lastFollowAt = .distantPast
        if !isListening { startListening() }   // Follow listens to the conversation too
        followTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.followTick()
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    /// Every few seconds: if the screen changed noticeably or new speech arrived, ask for suggestions.
    private func followTick() async {
        guard followMode, !isThinking, !followBusy else { return }
        guard Date().timeIntervalSince(lastFollowAt) >= 20 else { return }
        guard let fp = try? await ScreenCapture.fingerprint() else { return }
        let screenChanged = lastFingerprint.isEmpty || ScreenCapture.difference(fp, lastFingerprint) > 12
        let newSpeech = lines.count > lastFollowLineCount
        guard screenChanged || newSpeech, followMode, !isThinking else { return }
        lastFingerprint = fp
        lastFollowLineCount = lines.count
        lastFollowAt = Date()
        Log.write("follow: tick screenChanged=\(screenChanged) newSpeech=\(newSpeech)")
        run(label: "Follow", instruction: Self.followInstruction, isPreset: false, isFollow: true, reveal: false)
    }

    func setModel(_ slug: String) {
        model = slug
        UserDefaults.standard.set(slug, forKey: "model")
    }

    func setGlassOpacity(_ v: Double) {
        glassOpacity = v
        UserDefaults.standard.set(v, forKey: "glassOpacity")
    }

    private func buildPrompt(question: String) -> String {
        let recent = lines.suffix(300).map { "\($0.speaker.label): \($0.text)" }
        var transcript = recent
        if !partialThem.isEmpty { transcript.append("Them: \(partialThem)") }
        if !partialMe.isEmpty { transcript.append("Me: \(partialMe)") }

        let task = question.isEmpty
            ? "Figure out what I most likely need right now and give it to me. If someone just asked a question in the conversation, answer it as I should. If there is a problem, question or code on screen, solve it."
            : question

        let history = exchanges.suffix(4).compactMap { e -> String? in
            guard let a = e.answer else { return nil }
            if e.isFollow { return "You (follow-mode suggestion): \(a)" }
            return "Me: \(e.typed.isEmpty ? "(asked for help with the screen)" : e.typed)\nYou: \(a)"
        }
        let context = currentProfile.context.trimmingCharacters(in: .whitespacesAndNewlines)

        return """
        \(context.isEmpty ? "" : "Context about me / this session:\n<context>\n\(context)\n</context>\n")
        Attached is a screenshot of my screen right now.
        \(transcript.isEmpty ? "" : "Live transcript of the current conversation (\"Me\" = my microphone, \"Them\" = the other people / computer audio):\n<transcript>\n\(transcript.joined(separator: "\n"))\n</transcript>\n")
        \(history.isEmpty ? "" : "Earlier in this chat:\n<history>\n\(history.joined(separator: "\n\n"))\n</history>\n")
        Task: \(task)
        """
    }

    func reset() {
        askTask?.cancel()
        followBusy = false
        codex.cancel()
        isThinking = false
        exchanges = []
        errorText = nil
        cardOpen = false
        collapsed = false
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
            Log.write("transcript: +1 line (\(speaker.label)), \(self.lines.count) total")
            if self.lines.count > 400 { self.lines.removeFirst(self.lines.count - 400) }
            self.transcriptTick += 1
            if speaker == .them { self.scheduleAutoAnswer() }
            else { self.autoAnswerTask?.cancel() } // I started talking: don't interrupt
        }
        t.onError = { [weak self] message in self?.errorText = message }
        transcriber = t
        isListening = true
        isPaused = false
        recordedBefore = 0
        listenStart = Date()
        showTranscript = false
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
            self.ask(preset: .whatToSay, automatic: true)
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
        let wasListening = isListening
        autoAnswerTask?.cancel()
        listenStart = nil
        isPaused = false
        recordedBefore = 0
        if let t = transcriber {
            // Keep the transcriber alive until its last words arrive.
            Task { await t.stop(); Log.write("listen: stopped, \(self.lines.count) lines total") }
        }
        transcriber = nil
        isListening = false
        partialMe = ""
        partialThem = ""
        if wasListening {
            // Show the full transcript once recording stops (final words may still arrive for a moment).
            showTranscript = true
            cardOpen = true
            collapsed = false
            showPanel?()
        }
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
