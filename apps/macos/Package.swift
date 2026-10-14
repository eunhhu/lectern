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
            path: "Sources/LecternMenuBar",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("SwiftUI"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("Carbon")
            ]
        )
    ]
)
