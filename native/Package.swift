// swift-tools-version:5.9
import Foundation
import PackageDescription

// macOS helper for the Electron app: transcription (SpeechAnalyzer / SFSpeechRecognizer),
// screen capture (ScreenCaptureKit, excluding Machete's own windows) and text extraction (PDFKit / AppKit).
// Same frameworks and logic as the native Swift app, driven over stdin/stdout.
// Info.plist is embedded in the binary: the Speech framework requires its usage descriptions.
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path

let package = Package(
    name: "MacheteNative",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "machete-native",
            path: "Sources/MacheteNative",
            linkerSettings: [.unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist",
                                           "-Xlinker", "\(root)/Info.plist"])]
        )
    ]
)
