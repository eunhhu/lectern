// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LecternMenuBar",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "LecternMenuBar",
            dependencies: ["LecternMenuBarCore"],
            path: "Sources/LecternMenuBar",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("SwiftUI"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("Carbon")
            ]
        ),
        .target(
            name: "LecternMenuBarCore",
            path: "Sources/LecternMenuBarCore",
            linkerSettings: [.linkedFramework("Security")]
        ),
        .testTarget(
            name: "LecternMenuBarCoreTests",
            dependencies: ["LecternMenuBarCore"],
            path: "Tests/LecternMenuBarCoreTests"
        )
    ]
)
