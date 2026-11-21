import AppKit
import Carbon.HIToolbox
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let state = AppState()
    var panel: OverlayPanel!
    var statusItem: NSStatusItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        AppFonts.register()
        panel = OverlayPanel(rootView: OverlayView(state: state))
        panel.onUserResize = { [weak self] size, done in self?.state.setCardSize(size, persist: done) }
        state.onCardShowingChanged = { [weak self] showing in self?.panel.allowUserResize = showing }
        state.togglePanel = { [weak self] in self?.togglePanel() }
        state.showPanel = { [weak self] in self?.showPanel() }
        state.applyCaptureVisibility = { [weak self] visible in
            self?.panel.sharingType = visible ? .readOnly : .none
        }
        state.applyCaptureVisibility?(state.visibleInCapture)
        state.cardOpen = true
        showPanel()

        setupStatusItem()
        setupHotKeys()
        state.checkLogin()
        if CommandLine.arguments.contains("--debug-listen") { state.startListening() }
    }

    // MARK: Panel

    private var placedOnce = false

    func showPanel() {
        guard !panel.isVisible else { return }
        panel.orderFrontRegardless()
        // Top-center only the first time; after that, hiding and showing keeps wherever it was moved.
        guard !placedOnce else { return }
        placedOnce = true
        panel.positionTopCenter()
        // Re-pin once SwiftUI has sized the content.
        DispatchQueue.main.async { [weak self] in self?.panel.positionTopCenter() }
    }

    func togglePanel() {
        if panel.isVisible { panel.orderOut(nil) } else { showPanel() }
    }

    // MARK: Hotkeys (Carbon: no Accessibility permission needed)

    func setupHotKeys() {
        let hk = HotKeys.shared
        hk.register(keyCode: UInt32(kVK_Return), modifiers: UInt32(optionKey)) { [weak self] in
            self?.state.ask()
        }
        hk.register(keyCode: UInt32(kVK_ANSI_Backslash), modifiers: UInt32(optionKey)) { [weak self] in
            self?.togglePanel()
        }
        hk.register(keyCode: UInt32(kVK_ANSI_LeftBracket), modifiers: UInt32(cmdKey)) { [weak self] in
            self?.togglePanel()
        }
        hk.register(keyCode: UInt32(kVK_ANSI_M), modifiers: UInt32(optionKey)) { [weak self] in
            self?.state.toggleListening()
        }
        hk.register(keyCode: UInt32(kVK_ANSI_S), modifiers: UInt32(optionKey)) { [weak self] in
            self?.state.ask(.whatToSay)
        }
        hk.register(keyCode: UInt32(kVK_ANSI_R), modifiers: UInt32(optionKey)) { [weak self] in
            self?.state.reset()
        }
        hk.register(keyCode: UInt32(kVK_Space), modifiers: UInt32(optionKey)) { [weak self] in
            guard let self else { return }
            self.showPanel()
            self.panel.makeKey()
            self.state.focusInput.toggle()
        }
    }

    // MARK: Menu bar

    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "Machete")
        rebuildMenu()
    }

    func rebuildMenu() {
        let menu = NSMenu()
        menu.addItem(item("Show / Hide  (⌘[)", #selector(menuToggle)))
        menu.addItem(item("Ask about screen  (⌥↩)", #selector(menuAsk)))
        menu.addItem(item(state.isListening ? "Stop listening  (⌥M)" : "Start listening  (⌥M)", #selector(menuListen)))
        menu.addItem(item("What should I say?  (⌥S)", #selector(menuWhatToSay)))
        let auto = item("Auto-answer questions", #selector(menuAutoAnswer))
        auto.state = state.autoAnswer ? .on : .off
        menu.addItem(auto)
        menu.addItem(item("Clear  (⌥R)", #selector(menuReset)))
        menu.addItem(.separator())

        let langMenu = NSMenu()
        for (code, name) in AppState.languages {
            let i = item(name, #selector(menuLanguage(_:)))
            i.representedObject = code
            i.state = state.language == code ? .on : .off
            langMenu.addItem(i)
        }
        let langItem = NSMenuItem(title: "Transcription language", action: nil, keyEquivalent: "")
        langItem.submenu = langMenu
        menu.addItem(langItem)

        let opMenu = NSMenu()
        for (v, name) in [(0.35, "More see-through"), (0.55, "Balanced"), (0.8, "Solid")] {
            let i = item(name, #selector(menuOpacity(_:)))
            i.representedObject = v
            i.state = abs(state.glassOpacity - v) < 0.01 ? .on : .off
            opMenu.addItem(i)
        }
        let opItem = NSMenuItem(title: "Transparency", action: nil, keyEquivalent: "")
        opItem.submenu = opMenu
        menu.addItem(opItem)

        let modelMenu = NSMenu()
        for m in state.models {
            let i = item(m.name, #selector(menuModel(_:)))
            i.representedObject = m.slug
            i.state = state.model == m.slug ? .on : .off
            modelMenu.addItem(i)
        }
        let modelItem = NSMenuItem(title: "Model", action: nil, keyEquivalent: "")
        modelItem.submenu = modelMenu
        menu.addItem(modelItem)

        if state.directSignedIn {
            menu.addItem(NSMenuItem(title: "Signed in with ChatGPT ✓", action: nil, keyEquivalent: ""))
            menu.addItem(item("Sign out", #selector(menuSignOut)))
        } else {
            menu.addItem(item(state.loggedIn == true ? "Sign in with ChatGPT… (using Codex now)" : "Sign in with ChatGPT…", #selector(menuLogin)))
        }
        menu.addItem(.separator())
        menu.addItem(item("Quit Machete", #selector(menuQuit)))
        menu.delegate = self
        statusItem.menu = menu
    }

    private func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: "")
        i.target = self
        return i
    }

    @objc func menuToggle() { togglePanel() }
    @objc func menuAsk() { state.ask() }
    @objc func menuListen() { state.toggleListening() }
    @objc func menuReset() { state.reset() }
    @objc func menuLogin() { state.login() }
    @objc func menuQuit() { NSApp.terminate(nil) }
    @objc func menuWhatToSay() { state.ask(.whatToSay) }
    @objc func menuAutoAnswer() { state.setAutoAnswer(!state.autoAnswer) }
    @objc func menuSignOut() { state.signOut() }
    @objc func menuModel(_ sender: NSMenuItem) {
        if let slug = sender.representedObject as? String { state.setModel(slug) }
    }
    @objc func menuOpacity(_ sender: NSMenuItem) {
        if let v = sender.representedObject as? Double { state.setGlassOpacity(v) }
    }
    @objc func menuLanguage(_ sender: NSMenuItem) {
        if let code = sender.representedObject as? String { state.setLanguage(code) }
    }
}

extension AppDelegate: NSMenuDelegate {
    func menuWillOpen(_ menu: NSMenu) {
        // Refresh dynamic titles next time.
        DispatchQueue.main.async { [weak self] in self?.rebuildMenuIfNeeded() }
    }
    private func rebuildMenuIfNeeded() {}
    func menuDidClose(_ menu: NSMenu) { rebuildMenu() }
}
