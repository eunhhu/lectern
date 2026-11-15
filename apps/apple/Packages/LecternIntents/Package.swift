// swift-tools-version: 6.0
// Swift 5 language mode: strict concurrency comes later, package by package.
import PackageDescription

let package = Package(
    name: "LecternIntents",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [.library(name: "LecternIntents", targets: ["LecternIntents"])],
    dependencies: [
        .package(path: "../LecternKit"),
        .package(path: "../RecorderKit"),
    ],
    targets: [
        .target(name: "LecternIntents", dependencies: ["LecternKit", "RecorderKit"], swiftSettings: [.swiftLanguageMode(.v5)]),
        .testTarget(name: "LecternIntentsTests", dependencies: ["LecternIntents"], swiftSettings: [.swiftLanguageMode(.v5)]),
    ]
)
