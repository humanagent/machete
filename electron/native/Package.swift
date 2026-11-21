// swift-tools-version:5.9
import PackageDescription

// macOS helper for the Electron app: transcription (SpeechAnalyzer / SFSpeechRecognizer),
// screen capture (ScreenCaptureKit, excluding Machete's own windows) and text extraction (PDFKit / AppKit).
// Same frameworks and logic as the native Swift app, driven over stdin/stdout.
let package = Package(
    name: "MacheteNative",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "machete-native", path: "Sources/MacheteNative")
    ]
)
