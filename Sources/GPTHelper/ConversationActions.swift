import SwiftUI

/// Suggested next prompts. After each answer these are the model's own auto-generated suggestions;
/// before any answer, during a conversation, it offers the conversation presets.
/// Self-contained: only talks to AppState through `ask(...)`.
struct ConversationActions: View {
    @ObservedObject var state: AppState

    var body: some View {
        let suggestions = state.currentSuggestions
        let conversation = state.isListening || !state.lines.isEmpty
        if !state.isThinking && (!suggestions.isEmpty || conversation) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if !suggestions.isEmpty {
                        ForEach(Array(suggestions.enumerated()), id: \.offset) { i, text in
                            ActionChip(title: text, primary: i == 0) { state.ask(suggestion: text) }
                        }
                    } else {
                        ForEach(Preset.allCases, id: \.self) { preset in
                            ActionChip(title: preset.rawValue, primary: preset == .whatToSay) { state.ask(preset) }
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 4)
            .transition(.opacity)
        }
    }
}

private struct ActionChip: View {
    let title: String
    let primary: Bool
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .lineLimit(1)
                .padding(.horizontal, 14).padding(.vertical, 7)
                .background(Capsule().fill(primary
                    ? Color(red: 0.13, green: 0.3, blue: 0.75).opacity(hover ? 1 : 0.9)
                    : Color.white.opacity(hover ? 0.16 : 0.1)))
                .overlay(Capsule().strokeBorder(.white.opacity(0.12), lineWidth: 0.5))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}
