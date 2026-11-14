// swift-tools-version: 6.0
// Swift 5 language mode: strict concurrency comes later, package by package.
import PackageDescription

let package = Package(
    name: "LecternKit",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [.library(name: "LecternKit", targets: ["LecternKit"])],
    dependencies: [
        // The API v2 client is generated from packages/domain/openapi.json at build time (D-P6-7).
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.6.0"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.7.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.0.0"),
    ],
    targets: [
        .target(
            name: "LecternKit",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
            ],
            swiftSettings: [.swiftLanguageMode(.v5)],
            plugins: [.plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")]
        ),
        .testTarget(
            name: "LecternKitTests",
            dependencies: ["LecternKit"],
            resources: [.copy("Fixtures")],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
