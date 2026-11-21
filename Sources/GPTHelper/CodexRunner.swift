import Foundation

struct CodexError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Talks to ChatGPT through the Codex CLI, which is signed in with the user's ChatGPT plan.
final class CodexRunner {
    private var current: Process?
    private let lock = NSLock()

    private static let searchPath = [
        "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
        "\(NSHomeDirectory())/.npm-global/bin", "\(NSHomeDirectory())/.local/bin",
    ].joined(separator: ":")

    private static func resolveCodex() -> String? {
        for dir in searchPath.split(separator: ":") {
            let p = "\(dir)/codex"
            if FileManager.default.isExecutableFile(atPath: p) { return p }
        }
        return nil
    }

    private func setCurrent(_ p: Process?) { lock.lock(); current = p; lock.unlock() }

    func cancel() {
        lock.lock(); let p = current; current = nil; lock.unlock()
        if let p, p.isRunning { p.terminate() }
    }

    func run(prompt: String, image: URL?) async throws -> String {
        guard let codex = Self.resolveCodex() else {
            throw CodexError(message: "Codex CLI not found. Install it with `npm install -g @openai/codex`.")
        }
        let workDir = FileManager.default.temporaryDirectory.appendingPathComponent("gpt-helper", isDirectory: true)
        try? FileManager.default.createDirectory(at: workDir, withIntermediateDirectories: true)
        let outFile = workDir.appendingPathComponent("answer-\(UUID().uuidString).md")

        var args = [
            "exec", "--skip-git-repo-check", "--ephemeral",
            "--sandbox", "read-only", "--color", "never",
            "-c", "model_reasoning_effort=\"low\"",
            "-C", workDir.path,
            "-o", outFile.path,
        ]
        if let image { args += ["-i", image.path] }
        args += ["--", prompt]

        let (status, stderr) = try await launch(codex, args, cwd: workDir)
        defer { try? FileManager.default.removeItem(at: outFile) }
        if Task.isCancelled { throw CancellationError() }

        if let text = try? String(contentsOf: outFile, encoding: .utf8),
           !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if status == 15 || status == 9 { throw CancellationError() }
        let tail = stderr.split(separator: "\n").suffix(4).joined(separator: "\n")
        if tail.localizedCaseInsensitiveContains("login") || tail.localizedCaseInsensitiveContains("auth") {
            throw CodexError(message: "ChatGPT sign-in needed. Menu bar ✨ ▸ Sign in with ChatGPT…\n\(tail)")
        }
        throw CodexError(message: "Codex failed (exit \(status)).\n\(tail)")
    }

    func isLoggedIn() async -> Bool {
        guard let codex = Self.resolveCodex() else { return false }
        let r = try? await launch(codex, ["login", "status"], cwd: nil, track: false)
        return r?.0 == 0
    }

    func login() async -> Bool {
        guard let codex = Self.resolveCodex() else { return false }
        let r = try? await launch(codex, ["login"], cwd: nil, track: false)
        return r?.0 == 0
    }

    private func launch(_ exe: String, _ args: [String], cwd: URL?, track: Bool = true) async throws -> (Int32, String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = args
        if let cwd { p.currentDirectoryURL = cwd }
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = Self.searchPath + ":" + (env["PATH"] ?? "")
        env["NO_COLOR"] = "1"
        p.environment = env
        p.standardInput = FileHandle.nullDevice
        p.standardOutput = FileHandle.nullDevice
        let errPipe = Pipe()
        p.standardError = errPipe

        // Collect stderr incrementally so the pipe buffer never fills.
        let errData = LockedData()
        errPipe.fileHandleForReading.readabilityHandler = { h in errData.append(h.availableData) }

        if track { setCurrent(p) }

        return try await withCheckedThrowingContinuation { cont in
            p.terminationHandler = { proc in
                errPipe.fileHandleForReading.readabilityHandler = nil
                errData.append(errPipe.fileHandleForReading.readDataToEndOfFile())
                cont.resume(returning: (proc.terminationStatus, errData.string))
            }
            do { try p.run() } catch { cont.resume(throwing: error) }
        }
    }
}

private final class LockedData {
    private var data = Data()
    private let lock = NSLock()
    func append(_ d: Data) { lock.lock(); data.append(d); lock.unlock() }
    var string: String { lock.lock(); defer { lock.unlock() }; return String(decoding: data, as: UTF8.self) }
}
