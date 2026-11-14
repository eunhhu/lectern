// swift-tools-version: 6.0
// Swift 5 language mode: strict concurrency comes later, package by package.
import PackageDescription

let package = Package(
    name: "LecternUI",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [.library(name: "LecternUI", targets: ["LecternUI"])],
    dependencies: [
        .package(path: "../LecternKit"),
    ],
    targets: [
        .target(name: "LecternUI", dependencies: ["LecternKit"], swiftSettings: [.swiftLanguageMode(.v5)]),
        .testTarget(name: "LecternUITests", dependencies: ["LecternUI"], swiftSettings: [.swiftLanguageMode(.v5)]),
    ]
)
