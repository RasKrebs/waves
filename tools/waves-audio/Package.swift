// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "waves-audio",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "waves-audio",
            path: "Sources",
            linkerSettings: [
                .linkedFramework("AudioToolbox"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("CoreAudio"),
            ]
        )
    ]
)
