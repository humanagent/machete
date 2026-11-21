// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Machete",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "Machete",
            path: "Sources/Machete"
        )
    ]
)
