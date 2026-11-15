// swift-tools-version: 6.0
// Swift 5 language mode: strict concurrency comes later, package by package.
import PackageDescription

let package = Package(
    name: "LecternUI",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [.library(name: "LecternUI", targets: ["LecternUI"])],
    dependencies: [
        .package(path: "../LecternKit"),
        .package(path: "../LecternIntents"),
        .package(path: "../RecorderKit"),
    ],
    targets: [
        .target(name: "LecternUI", dependencies: ["LecternKit", "LecternIntents"], swiftSettings: [.swiftLanguageMode(.v5)]),
        .testTarget(
            name: "LecternUITests",
            dependencies: ["LecternUI", .product(name: "RecorderKit", package: "RecorderKit")],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
