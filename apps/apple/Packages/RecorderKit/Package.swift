// swift-tools-version: 6.0
// Swift 5 language mode: strict concurrency comes later, package by package.
import PackageDescription

let package = Package(
    name: "RecorderKit",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [.library(name: "RecorderKit", targets: ["RecorderKit"])],
    targets: [
        .target(name: "RecorderKit", swiftSettings: [.swiftLanguageMode(.v5)]),
        .testTarget(name: "RecorderKitTests", dependencies: ["RecorderKit"], swiftSettings: [.swiftLanguageMode(.v5)]),
    ]
)
