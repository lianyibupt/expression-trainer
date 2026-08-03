// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "SystemAudioHelper",
  platforms: [.macOS(.v13)],
  products: [
    .executable(name: "system-audio-probe", targets: ["SystemAudioProbe"])
  ],
  targets: [
    .executableTarget(
      name: "SystemAudioProbe",
      path: "Sources/SystemAudioProbe",
      linkerSettings: [
        .linkedFramework("ScreenCaptureKit"),
        .linkedFramework("AVFoundation"),
        .linkedFramework("CoreMedia"),
        .linkedFramework("CoreGraphics")
      ]
    )
  ]
)
