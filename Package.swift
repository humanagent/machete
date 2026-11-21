// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "GPTHelper",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "GPTHelper",
            path: "Sources/GPTHelper"
        )
    ]
)
