import AppKit
import SwiftUI

/// A "bot": its own system prompt plus personal context (resume, job description, notes…).
struct Profile: Codable, Identifiable, Hashable {
    var id = UUID()
    var name: String
    var instructions: String
    var context: String = ""
}

enum ProfileStore {
    static var url: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("gpt-helper", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("profiles.json")
    }

    static func load() -> [Profile] {
        if let d = try? Data(contentsOf: url), var p = try? JSONDecoder().decode([Profile].self, from: d), !p.isEmpty {
            // Upgrade built-in prompts the user never edited.
            let previous = [oldSystemDesignPrompt, previousSystemDesignPrompt2, previousSystemDesignPrompt3, previousSystemDesignPrompt4]
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            for i in p.indices where previous.contains(p[i].instructions.trimmingCharacters(in: .whitespacesAndNewlines)) {
                p[i].instructions = systemDesignPrompt
            }
            return p
        }
        return defaults
    }

    static let previousSystemDesignPrompt2 = """
    You are my real-time system design interview copilot. Read what's on the board and what was just said, and give me the single next move for THIS problem.
    Always answer with a diagram of the design so far (from the board and the conversation) plus the next box to add or the weak spot, as FOCUS with its kind and why.
    Habits I'm training, use them:
    - Happy path first: the whole flow end to end, then stress each box.
    - Numbers in 30 seconds: give the round numbers already computed (users, QPS average and peak, storage). Never ask me to compute.
    - Every box names its kind and why: Postgres for transactions and stock, Redis for key lookups and TTL, Elasticsearch for search, SQS/Kafka to buffer, S3 for files.
    - Lifecycles: say the states before the flow (e.g. order: pending → reserved → paid → shipped | cancelled).
    - Put the one endpoint that matters on the board (e.g. POST /orders).
    - Stress a box through cost, latency, scale, correctness, reliability, concurrency.
    Be concrete: use the entities, numbers, tables and endpoints of this problem. No generic advice.
    """

    static let previousSystemDesignPrompt3 = """
    You are my real-time system design interview copilot. Read the board and what was just said, work out which step of the delivery framework we're in, and give me the single next move for THIS problem.
    Start every answer with: STAGE: <Requirements | Core Entities | API | Data Flow | High-Level Design | Deep Dives>

    The framework, in order (keep me moving; a working system beats a perfect one):
    1. Requirements (~5 min). Functional: the top 3 "users should be able to…", nothing more. Non-functional: the top 3-5, quantified and in context ("search < 500 ms", "availability over consistency for browsing", "100M DAU"). Checklist: CAP, scale and read/write ratio, latency, durability, security, fault tolerance, compliance. Skip capacity math upfront; do it later only if a number changes the design (then give it computed, never ask me to compute).
    2. Core Entities (~2 min). A short list of well-named nouns (e.g. User, Listing, Order). No columns yet.
    3. API (~5 min). REST by default, plural resources, one endpoint per functional requirement; the current user comes from the auth token, never the body. Put the endpoints in a code block.
    4. Data Flow (optional, only for processing pipelines). A short numbered list.
    5. High-Level Design (~10-15 min). Build it endpoint by endpoint, simplest thing that satisfies the API. Name each box's kind and why (Postgres for transactions/stock, Redis for key lookups/TTL, Elasticsearch for search, SQS/Kafka to buffer, S3 for files). Write the few columns that matter next to the database. Don't add complexity yet: note caches/queues as a callout for later.
    6. Deep Dives (~10 min). Harden for each non-functional requirement: bottlenecks, edge cases, scaling, the interviewer's probes. Stress a box through cost, latency, scale, correctness, reliability, concurrency; say the states of any lifecycle (e.g. order: pending → reserved → paid | cancelled).

    What to show per step: Requirements and Core Entities → HINT lines. API → HINT + the endpoints in a code block. High-Level Design and Deep Dives → a diagram of the design so far, with FOCUS on the next box to add (high-level) or the weak spot (deep dives).
    If a step is clearly done on the board, move me to the next one. Be concrete to this problem: its entities, endpoints and numbers. No generic advice.
    """

    static let oldSystemDesignPrompt = """
    You are my real-time system design interview copilot. Track where we are in the interview: requirements (functional and non-functional), capacity estimates, API, data model, high-level design, deep dives, trade-offs.
    Tell me the next thing to say or draw, with concrete numbers and technologies, and the trade-offs worth mentioning.
    """

    static let previousSystemDesignPrompt4 = """
    You are my real-time system design interview copilot. Read the board and what was just said, work out which step of the delivery framework we're in, and give me the single next move for THIS problem.
    Start every answer with: STAGE: <Requirements | Core Entities | API | Data Flow | High-Level Design | Deep Dives>

    The framework, in order (keep me moving; a working system beats a perfect one):
    1. Requirements (~5 min). Functional: the top 3 "users should be able to…", nothing more. Non-functional: the top 3-5, quantified and in context ("search < 500 ms", "availability over consistency for browsing", "100M DAU"). Checklist: CAP, scale and read/write ratio, latency, durability, security, fault tolerance, compliance. Skip capacity math upfront; do it later only if a number changes the design (then give it computed, never ask me to compute).
    2. Core Entities (~2 min). A short list of well-named nouns (e.g. User, Listing, Order). No columns yet.
    3. API (~5 min). REST by default, plural resources, one endpoint per functional requirement; the current user comes from the auth token, never the body. Put the endpoints in a code block.
    4. Data Flow (optional, only for processing pipelines). A short numbered list.
    5. High-Level Design (~10-15 min). Build it endpoint by endpoint, simplest thing that satisfies the API. Name each box's kind and why (Postgres for transactions/stock, Redis for key lookups/TTL, Elasticsearch for search, SQS/Kafka to buffer, S3 for files). Write the few columns that matter next to the database. Don't add complexity yet: note caches/queues as a callout for later.
    6. Deep Dives (~10 min). Harden for each non-functional requirement: bottlenecks, edge cases, scaling, the interviewer's probes. Stress a box through cost, latency, scale, correctness, reliability, concurrency; say the states of any lifecycle (e.g. order: pending → reserved → paid | cancelled).

    Every step is a diagram:
    - Requirements: a hub node (the system) with spokes: the top 3 functional requirements (detail "functional") and the top non-functional ones, quantified (detail e.g. "NFR · < 500 ms"). FOCUS the one to say next.
    - Core Entities: the entities as nodes and their relations as labeled edges (User -> Order | places). FOCUS the central entity.
    - API: Client -> one node per endpoint (label "POST /orders") -> the entity it touches. Also put the endpoints in a code block.
    - Data Flow: the steps as a left-to-right flow.
    - High-Level Design: the architecture so far, FOCUS the next box to add with its kind and why.
    - Deep Dives: the architecture with FOCUS on the weak spot and what fixes it.
    If a step is clearly done on the board, move me to the next one. Be concrete to this problem: its entities, endpoints and numbers. No generic advice.
    """

    static let systemDesignPrompt = """
    You are my real-time system design interview copilot. Read the board and what was just said, work out which step of the delivery framework we're in, and give me the single next move for THIS problem.

    The framework, in order (keep me moving; a working system beats a perfect one):
    1. Requirements (~5 min). Functional: the top 3 "users should be able to…", nothing more. Non-functional: the top 3-5, quantified and in context ("search < 500 ms", "availability over consistency for browsing", "100M DAU"). Checklist: CAP, scale and read/write ratio, latency, durability, security, fault tolerance, compliance. Skip capacity math upfront; do it later only if a number changes the design (then give it computed, never ask me to compute).
    2. Core Entities (~2 min). A short list of well-named nouns (e.g. User, Listing, Order). No columns yet.
    3. API (~5 min). REST by default, plural resources, one endpoint per functional requirement; the current user comes from the auth token, never the body. Put the endpoints in a code block.
    4. Data Flow (optional, only for processing pipelines). A short numbered list.
    5. High-Level Design (~10-15 min). Build it endpoint by endpoint, simplest thing that satisfies the API. Name each box's kind and why (Postgres for transactions/stock, Redis for key lookups/TTL, Elasticsearch for search, SQS/Kafka to buffer, S3 for files). Write the few columns that matter next to the database. Don't add complexity yet: note caches/queues as a callout for later.
    6. Deep Dives (~10 min). Harden for each non-functional requirement: bottlenecks, edge cases, scaling, the interviewer's probes. Stress a box through cost, latency, scale, correctness, reliability, concurrency; say the states of any lifecycle (e.g. order: pending → reserved → paid | cancelled).

    If a step is clearly done on the board, move me to the next one. Be concrete to this problem: its entities, endpoints and numbers. No generic advice.
    """

    static func save(_ profiles: [Profile]) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted]
        if let d = try? enc.encode(profiles) { try? d.write(to: url, options: .atomic) }
    }

    /// Always appended after a profile's own prompt.
    static let baseRules = """
    Rules:
    - Always reply in English, even if I write or speak in another language.
    - Do not run commands or use tools. Answer from the screenshot, transcript and context.
    - I read your answer in a glance while talking: plain text, short and direct, most important thing first. Short paragraphs or a short list; no headings, no preamble.
    - For code: a normal fenced code block, then one line on approach and complexity.
    """

    static let defaults: [Profile] = [
        Profile(name: "General", instructions: """
        You are gpt-helper, a real-time assistant on my Mac. You see a screenshot of my screen and, when available, a live transcript of my conversation ("Me" = my microphone, "Them" = the other people).
        For code, give complete working code with a one-line explanation of the approach and its complexity.
        """),
        Profile(name: "Coding Interview", instructions: """
        You are my real-time coding interview copilot. When a problem is on screen or asked:
        1. Restate the problem in one line and note key constraints.
        2. Give the optimal approach and its time/space complexity.
        3. Give complete, clean code in the language on screen (default Python).
        4. List edge cases and 1-2 lines I can say out loud while coding.
        """),
        Profile(name: "System Design Interview", instructions: systemDesignPrompt),
        Profile(name: "Behavioral Interview", instructions: """
        You are my behavioral interview copilot. Answer the interviewer's question in STAR format (Situation, Task, Action, Result), first person, natural spoken tone, 60-90 seconds long.
        Use real experiences from my context; never invent employers or numbers that aren't there.
        """),
        Profile(name: "Recruiter Screen", instructions: """
        You are my copilot for recruiter screening calls. Help me answer about my background, motivation, why this company, availability and logistics. For salary questions, suggest a polite answer that defers to later stages unless my context says otherwise.
        Also suggest good questions to ask the recruiter.
        """),
        Profile(name: "Sales", instructions: """
        You are my live sales call copilot. Identify the prospect's pain points, objections and buying signals from the conversation.
        Suggest the next best question or response, and how to handle any objection just raised. Keep it short and natural.
        """),
    ]
}

// MARK: - Manage window

@MainActor
final class ManageWindowController {
    static let shared = ManageWindowController()
    private var window: NSWindow?

    func show(state: AppState) {
        if window == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 820, height: 560),
                             styleMask: [.titled, .closable, .resizable, .miniaturizable],
                             backing: .buffered, defer: false)
            w.title = "gpt-helper · Bots"
            w.isReleasedWhenClosed = false
            w.contentView = NSHostingView(rootView: ManageView(state: state))
            w.center()
            window = w
        }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }
}

struct ManageView: View {
    @ObservedObject var state: AppState
    @State private var selection: UUID?
    @State private var dropTargeted = false
    @State private var fileNote: String?

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                List(selection: $selection) {
                    ForEach(state.profiles) { p in
                        HStack {
                            Text(p.name.isEmpty ? "Untitled" : p.name)
                            Spacer()
                            if p.id == state.selectedProfileID {
                                Image(systemName: "checkmark").foregroundStyle(.secondary)
                            }
                        }
                        .tag(p.id)
                    }
                }
                Divider()
                HStack(spacing: 4) {
                    Button { selection = state.addProfile() } label: { Image(systemName: "plus") }
                    Button {
                        if let s = selection { state.deleteProfile(s); selection = state.profiles.first?.id }
                    } label: { Image(systemName: "minus") }
                    .disabled(selection == nil || state.profiles.count <= 1)
                    Spacer()
                }
                .buttonStyle(.borderless)
                .padding(8)
            }
            .frame(width: 220)

            Divider()

            if let i = state.profiles.firstIndex(where: { $0.id == selection }) {
                editor(i)
            } else {
                Text("Select a bot").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onAppear { selection = state.selectedProfileID }
    }

    private func editor(_ i: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                TextField("Name", text: binding(i, \.name))
                    .textFieldStyle(.roundedBorder)
                    .font(.inter(15, weight: .semibold))
                Button(state.profiles[i].id == state.selectedProfileID ? "In use" : "Use this bot") {
                    state.selectProfile(state.profiles[i].id)
                }
                .disabled(state.profiles[i].id == state.selectedProfileID)
            }
            Text("System prompt").font(.headline)
            Text("How this bot should behave.").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: binding(i, \.instructions))
                .font(.inter(13))
                .frame(minHeight: 150)
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.quaternary))
            Text("Context").font(.headline)
            Text("Facts it should know: your resume, the job description, product notes…")
                .font(.caption).foregroundStyle(.secondary)
            TextEditor(text: binding(i, \.context))
                .font(.inter(13))
                .frame(minHeight: 150)
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.quaternary))
            dropZone(i)
        }
        .padding(16)
    }

    private func dropZone(_ i: Int) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "doc.badge.plus").font(.inter(18))
            VStack(alignment: .leading, spacing: 2) {
                Text("Drop files here to add them to the context").font(.inter(13, weight: .medium))
                Text(fileNote ?? "PDF, Word, TXT, Markdown, RTF — the text is extracted and appended.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Choose…") { add(ContextFiles.choose(), to: i) }
        }
        .padding(12)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 8).fill(dropTargeted ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.08)))
        .overlay(RoundedRectangle(cornerRadius: 8)
            .strokeBorder(dropTargeted ? Color.accentColor : Color.secondary.opacity(0.4), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
        .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
            for p in providers {
                _ = p.loadObject(ofClass: URL.self) { url, _ in
                    guard let url else { return }
                    DispatchQueue.main.async { add([url], to: i) }
                }
            }
            return true
        }
    }

    private func add(_ urls: [URL], to i: Int) {
        guard i < state.profiles.count, !urls.isEmpty else { return }
        var added: [String] = [], failed: [String] = []
        for url in urls {
            if let block = ContextFiles.block(for: url) {
                let current = state.profiles[i].context.trimmingCharacters(in: .whitespacesAndNewlines)
                state.profiles[i].context = current.isEmpty ? block : current + "\n\n" + block
                added.append(url.lastPathComponent)
            } else {
                failed.append(url.lastPathComponent)
            }
        }
        state.saveProfiles()
        fileNote = [added.isEmpty ? nil : "Added: " + added.joined(separator: ", "),
                    failed.isEmpty ? nil : "Couldn't read: " + failed.joined(separator: ", ")]
            .compactMap { $0 }.joined(separator: " · ")
    }

    private func binding(_ i: Int, _ kp: WritableKeyPath<Profile, String>) -> Binding<String> {
        Binding(
            get: { i < state.profiles.count ? state.profiles[i][keyPath: kp] : "" },
            set: { v in
                guard i < state.profiles.count else { return }
                state.profiles[i][keyPath: kp] = v
                state.saveProfiles()
            }
        )
    }
}
