// swift-tools-version: 6.0
// Swift 5 language mode: strict concurrency comes later, package by package.
import PackageDescription

let package = Package(
    name: "LecternKit",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [.library(name: "LecternKit", targets: ["LecternKit"])],
    targets: [
        .target(name: "LecternKit", swiftSettings: [.swiftLanguageMode(.v5)]),
        .testTarget(name: "LecternKitTests", dependencies: ["LecternKit"], swiftSettings: [.swiftLanguageMode(.v5)]),
    ]
)
