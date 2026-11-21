import AppKit

// One-time move of data saved by the app's previous name (ChatGPT sign-in, bots) to Machete's folder.
do {
    let fm = FileManager.default
    if let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
        let old = support.appendingPathComponent("gpt-helper", isDirectory: true)
        let new = support.appendingPathComponent("Machete", isDirectory: true)
        if fm.fileExists(atPath: old.path) && !fm.fileExists(atPath: new.path) {
            try? fm.moveItem(at: old, to: new)
        }
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    withExtendedLifetime(delegate) { app.run() }
}
