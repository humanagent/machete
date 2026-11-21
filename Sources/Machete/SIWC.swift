import AppKit
import CryptoKit
import Foundation
import Network
import Security

// "Sign in with ChatGPT" (developers.openai.com/siwc): OAuth on a loopback redirect, then Responses API
// requests billed to the user's ChatGPT plan.

struct SIWCTokens: Codable {
    var clientID: String
    var accessToken: String
    var refreshToken: String
    var idToken: String?
    var expiresAt: Date
}

struct SIWCError: LocalizedError {
    let message: String
    var needsSignIn = false
    var errorDescription: String? { message }
}

/// Stores credentials in ~/Library/Application Support/Machete/siwc.json, readable only by this user (0600).
/// (Avoids repeated Keychain prompts for a self-signed local build.)
enum TokenStore {
    static var url: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Machete", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        return dir.appendingPathComponent("siwc.json")
    }

    static func load() -> Data? { try? Data(contentsOf: url) }

    static func save(_ data: Data) {
        let u = url
        FileManager.default.createFile(atPath: u.path, contents: data, attributes: [.posixPermissions: 0o600])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: u.path)
    }

    static func delete() { try? FileManager.default.removeItem(at: url) }
}

actor SIWCAuth {
    static let shared = SIWCAuth()

    private let authorizeURL = "https://auth.openai.com/api/accounts/authorize"
    private let tokenURL = URL(string: "https://auth.openai.com/api/accounts/oauth/token")!
    static let resource = "https://api.openai.com/v1"
    private let scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"

    private var tokens: SIWCTokens?
    private var refreshTask: Task<String, Error>?

    init() {
        if let d = TokenStore.load() {
            tokens = try? JSONDecoder().decode(SIWCTokens.self, from: d)
        }
    }

    var isSignedIn: Bool { tokens != nil }

    /// Stable per-install host id, as required by `ext_agent_host_id`.
    private var hostID: String {
        if let id = UserDefaults.standard.string(forKey: "siwcHostID") { return id }
        let id = "urn:uuid:\(UUID().uuidString.lowercased())"
        UserDefaults.standard.set(id, forKey: "siwcHostID")
        return id
    }

    /// The client id issued at first registration (kept across sign-outs so re-auth reuses it).
    private var savedClientID: String? {
        get { UserDefaults.standard.string(forKey: "siwcClientID") }
        set { UserDefaults.standard.set(newValue, forKey: "siwcClientID") }
    }

    private func store(_ t: SIWCTokens?) {
        tokens = t
        if let t, let d = try? JSONEncoder().encode(t) { TokenStore.save(d) }
        else { TokenStore.delete() }
    }

    func signOut() { store(nil) }

    // MARK: Sign in

    func signIn() async throws {
        let verifier = Self.randomURLSafe(48)
        let challenge = Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = Self.randomURLSafe(24)
        let nonce = Self.randomURLSafe(24)

        let server = LoopbackServer()
        let port = try await server.start(preferred: 1455)
        defer { server.stop() }
        let redirect = "http://127.0.0.1:\(port)/auth/callback"

        let existing = savedClientID
        var items: [(String, String)] = [("client_id", existing ?? "dynamic_agent_client")]
        if existing == nil { items.append(("agent_name_hint", "Machete")) }
        items += [
            ("ext_agent_host_id", hostID),
            ("response_type", "code"),
            ("redirect_uri", redirect),
            ("scope", scope),
            ("resource", Self.resource),
            ("state", state),
            ("nonce", nonce),
            ("code_challenge_method", "S256"),
            ("code_challenge", challenge),
        ]
        if let idt = tokens?.idToken { items.append(("id_token_hint", idt)) }

        let url = URL(string: authorizeURL + "?" + Self.formEncode(items))!
        await MainActor.run { _ = NSWorkspace.shared.open(url) }

        let query = try await server.waitForCallback(timeout: 300)
        guard query["state"] == state else { throw SIWCError(message: "Sign-in failed: state mismatch.") }
        if let err = query["error"] {
            throw SIWCError(message: err == "access_denied" ? "Sign-in was cancelled." : "Sign-in failed: \(query["error_description"] ?? err)")
        }
        guard let code = query["code"] else { throw SIWCError(message: "Sign-in failed: no authorization code.") }

        let returned = query["client_id"]
        if let existing, let returned, returned != existing {
            throw SIWCError(message: "Sign-in failed: unexpected client id.")
        }
        guard let clientID = returned ?? existing else {
            throw SIWCError(message: "Sign-in failed: ChatGPT did not complete app registration.")
        }
        savedClientID = clientID

        let json = try await postForm([
            ("grant_type", "authorization_code"),
            ("client_id", clientID),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", redirect),
            ("resource", Self.resource),
        ])
        store(try tokens(from: json, clientID: clientID, previous: nil))
    }

    // MARK: Tokens

    func accessToken() async throws -> String {
        guard let t = tokens else { throw SIWCError(message: "Not signed in with ChatGPT.", needsSignIn: true) }
        if t.expiresAt.timeIntervalSinceNow > 90 { return t.accessToken }
        if let r = refreshTask { return try await r.value }
        let task = Task { try await self.refresh() }
        refreshTask = task
        defer { refreshTask = nil }
        return try await task.value
    }

    private func refresh() async throws -> String {
        guard let t = tokens else { throw SIWCError(message: "Not signed in with ChatGPT.", needsSignIn: true) }
        do {
            let json = try await postForm([
                ("grant_type", "refresh_token"),
                ("client_id", t.clientID),
                ("refresh_token", t.refreshToken),
                ("resource", Self.resource),
            ])
            let nt = try tokens(from: json, clientID: t.clientID, previous: t)
            store(nt)
            return nt.accessToken
        } catch let e as SIWCError where e.needsSignIn {
            store(nil)
            throw e
        }
    }

    private func tokens(from json: [String: Any], clientID: String, previous: SIWCTokens?) throws -> SIWCTokens {
        guard let access = json["access_token"] as? String else {
            throw SIWCError(message: "Sign-in failed: no access token returned.")
        }
        let expires = (json["expires_in"] as? Double) ?? Double(json["expires_in"] as? Int ?? 3600)
        return SIWCTokens(
            clientID: clientID,
            accessToken: access,
            refreshToken: json["refresh_token"] as? String ?? previous?.refreshToken ?? "",
            idToken: json["id_token"] as? String ?? previous?.idToken,
            expiresAt: Date().addingTimeInterval(expires)
        )
    }

    private func postForm(_ items: [(String, String)]) async throws -> [String: Any] {
        var req = URLRequest(url: tokenURL)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.httpBody = Data(Self.formEncode(items).utf8)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if status != 200 {
            let code = json["error"] as? String ?? (json["error"] as? [String: Any])?["code"] as? String ?? "http_\(status)"
            let relogin = ["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired",
                           "refresh_token_invalidated", "refresh_token_reused"].contains(code)
            let desc = json["error_description"] as? String ?? String(decoding: data.prefix(300), as: UTF8.self)
            throw SIWCError(message: relogin ? "ChatGPT session expired. Sign in again." : "ChatGPT sign-in error (\(code)): \(desc)",
                            needsSignIn: relogin)
        }
        return json
    }

    // MARK: Helpers

    static func formEncode(_ items: [(String, String)]) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return items.map { k, v in
            "\(k.addingPercentEncoding(withAllowedCharacters: allowed)!)=\(v.addingPercentEncoding(withAllowedCharacters: allowed)!)"
        }.joined(separator: "&")
    }

    static func randomURLSafe(_ bytes: Int) -> String {
        var b = [UInt8](repeating: 0, count: bytes)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes, &b)
        return base64url(Data(b))
    }

    static func base64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

// MARK: - Loopback HTTP server for the OAuth redirect

final class LoopbackServer: @unchecked Sendable {
    private var listener: NWListener?
    private let lock = NSLock()
    private var result: Result<[String: String], Error>?
    private var waiter: CheckedContinuation<[String: String], Error>?
    private let queue = DispatchQueue(label: "machete.loopback")

    func start(preferred: UInt16) async throws -> UInt16 {
        if let p = try? await listen(on: preferred) { return p }
        return try await listen(on: 0)
    }

    private func listen(on port: UInt16) async throws -> UInt16 {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback),
                                                 port: port == 0 ? .any : NWEndpoint.Port(rawValue: port)!)
        let l = try NWListener(using: params)
        l.newConnectionHandler = { [weak self] c in self?.handle(c) }
        return try await withCheckedThrowingContinuation { cont in
            var resumed = false
            l.stateUpdateHandler = { st in
                guard !resumed else { return }
                switch st {
                case .ready:
                    resumed = true
                    self.listener = l
                    cont.resume(returning: l.port?.rawValue ?? port)
                case .failed(let e):
                    resumed = true
                    l.cancel()
                    cont.resume(throwing: e)
                default: break
                }
            }
            l.start(queue: queue)
        }
    }

    func stop() { listener?.cancel(); listener = nil }

    func waitForCallback(timeout: Double) async throws -> [String: String] {
        try await withTimeout(timeout, "Sign-in timed out.") {
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<[String: String], Error>) in
                self.lock.lock()
                if let r = self.result { self.lock.unlock(); c.resume(with: r); return }
                self.waiter = c
                self.lock.unlock()
            }
        }
    }

    private func deliver(_ r: Result<[String: String], Error>) {
        lock.lock()
        guard result == nil else { lock.unlock(); return }
        result = r
        let w = waiter
        waiter = nil
        lock.unlock()
        w?.resume(with: r)
    }

    private func handle(_ c: NWConnection) {
        c.start(queue: queue)
        c.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, _, _ in
            guard let self, let data, let req = String(data: data, encoding: .utf8),
                  let line = req.split(separator: "\r\n").first else { c.cancel(); return }
            let parts = line.split(separator: " ")
            let target = parts.count > 1 ? String(parts[1]) : "/"
            let comps = URLComponents(string: "http://127.0.0.1" + target)
            guard comps?.path == "/auth/callback" else {
                self.respond(c, status: "404 Not Found", body: "Not found")
                return
            }
            var q: [String: String] = [:]
            for item in comps?.queryItems ?? [] { q[item.name] = item.value ?? "" }
            let ok = q["error"] == nil
            self.respond(c, status: "200 OK", body: ok
                ? "<h2 style='font-family:-apple-system'>Machete is connected to ChatGPT.</h2><p style='font-family:-apple-system'>You can close this tab.</p>"
                : "<h2 style='font-family:-apple-system'>Sign-in was not completed.</h2>")
            self.deliver(.success(q))
        }
    }

    private func respond(_ c: NWConnection, status: String, body: String) {
        let resp = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
        c.send(content: Data(resp.utf8), completion: .contentProcessed { _ in c.cancel() })
    }
}

// MARK: - Responses API (streaming)

struct ResponsesClient {
    static let endpoint = URL(string: "https://api.openai.com/v1/responses")!

    /// Streams the answer; `onText` receives the full text so far.
    static func ask(model: String, instructions: String, text: String, imageDataURL: String?,
                    effort: String?, onText: @escaping @MainActor (String) -> Void) async throws -> String {
        let token = try await SIWCAuth.shared.accessToken()
        do {
            return try await send(token: token, model: model, instructions: instructions, text: text,
                                  image: imageDataURL, effort: effort, onText: onText)
        } catch let e as SIWCError where effort != nil && e.message.contains("reasoning") {
            // Model doesn't accept a reasoning setting: retry without it.
            return try await send(token: token, model: model, instructions: instructions, text: text,
                                  image: imageDataURL, effort: nil, onText: onText)
        }
    }

    private static func send(token: String, model: String, instructions: String, text: String, image: String?,
                             effort: String?, onText: @escaping @MainActor (String) -> Void) async throws -> String {
        var content: [[String: Any]] = [["type": "input_text", "text": text]]
        if let image { content.append(["type": "input_image", "image_url": image]) }
        var body: [String: Any] = [
            "model": model,
            "instructions": instructions,
            "input": [["role": "user", "content": content]],
            "store": false,
            "stream": true,
        ]
        if let effort { body["reasoning"] = ["effort": effort] }

        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        req.timeoutInterval = 120

        let (bytes, resp) = try await URLSession.shared.bytes(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status != 200 {
            var raw = Data()
            for try await b in bytes { raw.append(b); if raw.count > 8000 { break } }
            throw parseError(raw, status: status)
        }

        var full = ""
        for try await line in bytes.lines {
            try Task.checkCancellation()
            guard line.hasPrefix("data:") else { continue }
            let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            if payload == "[DONE]" { break }
            guard let d = payload.data(using: .utf8),
                  let ev = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
                  let type = ev["type"] as? String else { continue }
            switch type {
            case "response.output_text.delta":
                if let delta = ev["delta"] as? String {
                    full += delta
                    let snapshot = full
                    await onText(snapshot)
                }
            case "response.completed", "response.incomplete":
                return full
            case "response.failed", "error":
                let errObj = ((ev["response"] as? [String: Any])?["error"] as? [String: Any]) ?? (ev["error"] as? [String: Any]) ?? ev
                throw describe(code: errObj["code"] as? String, message: errObj["message"] as? String, status: status)
            default:
                break
            }
        }
        return full
    }

    private static func parseError(_ data: Data, status: Int) -> SIWCError {
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if let err = json["error"] as? [String: Any] {
            return describe(code: err["code"] as? String, message: err["message"] as? String, status: status)
        }
        let detail = json["detail"] as? String ?? String(decoding: data.prefix(300), as: UTF8.self)
        return describe(code: nil, message: detail, status: status)
    }

    static func describe(code: String?, message: String?, status: Int) -> SIWCError {
        switch code {
        case "subscription_sharing_usage_limit_exceeded":
            return SIWCError(message: "You've hit your ChatGPT plan's usage limit for Machete for now.")
        case "subscription_sharing_invalid_user":
            return SIWCError(message: "ChatGPT session is no longer valid. Sign in again.", needsSignIn: true)
        case "subscription_sharing_user_not_eligible":
            return SIWCError(message: "This ChatGPT account's plan can't be used in other apps (needs Plus or Pro).")
        case "subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable":
            return SIWCError(message: "ChatGPT plan usage is temporarily unavailable. Try again in a moment.")
        default:
            let m = message ?? "Request failed"
            return SIWCError(message: "ChatGPT error\(status != 0 && status != 200 ? " \(status)" : "")\(code.map { " (\($0))" } ?? ""): \(m)",
                             needsSignIn: status == 401)
        }
    }

    /// Models the user's plan can use (`visibility == "list"`).
    static func listModels() async throws -> [(slug: String, name: String)] {
        let token = try await SIWCAuth.shared.accessToken()
        var req = URLRequest(url: URL(string: "https://api.openai.com/v1/models")!)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: req)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let arr = (json["data"] as? [[String: Any]]) ?? (json["models"] as? [[String: Any]]) ?? []
        return arr.compactMap { m in
            if let vis = m["visibility"] as? String, vis != "list" { return nil }
            guard let slug = (m["slug"] as? String) ?? (m["id"] as? String) else { return nil }
            return (slug, (m["display_name"] as? String) ?? slug)
        }
    }
}
