// swift-tools-version: 6.0
import PackageDescription
import Foundation

// Absolute path to this package, so the vendored Cubism Core static lib can be
// linked by absolute path (SwiftPM has no first-class "vendored static lib").
let packageDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path

// The Live2D Cubism renderer is OPT-IN. It links the proprietary Cubism Core
// (a manual, free, third-party download — see Vendor/Live2DCore/README.md), so
// the DEFAULT build must never require it: the bundled `spineboy` Spine sample
// renders with zero downloads. Set FAMILIAR_LIVE2D=1 (what `familiar avatar
// --live2d` does) to pull in the Cubism target + the `LIVE2D` compile flag. When
// off, the CubismLive2D target isn't in the package at all, so `swift build`
// works on a fresh clone without any Cubism files present.
let live2dEnabled = ProcessInfo.processInfo.environment["FAMILIAR_LIVE2D"] == "1"

// FamiliarAvatar's dependency on the Cubism renderer + its compile flag are added
// only when Live2D is enabled; the Spine path (the default) needs neither.
var avatarDependencies: [Target.Dependency] = ["CSpine"]
var avatarSwiftSettings: [SwiftSetting] = []
if live2dEnabled {
    avatarDependencies.append("CubismLive2D")
    avatarSwiftSettings.append(.define("LIVE2D"))
}

var targets: [Target] = [
    // C++ target: vendored spine-cpp + a pure-C bridge. Only include/spine_bridge.h
    // is public (Swift-visible); the spine-cpp C++ headers live on a private
    // header-search-path so they never reach Swift's clang importer.
    .target(
        name: "CSpine",
        cxxSettings: [
            .headerSearchPath("spine_include")
        ]
    ),
    // The native AppKit/Metal overlay app. Subscribes to avatar.sock, decodes
    // NDJSON AvatarCommand frames, maps semantic tokens -> spineboy animations.
    // Live2D support is compiled in only under the LIVE2D flag (#if LIVE2D);
    // without it the app is spineboy-only and links no proprietary code.
    .executableTarget(
        name: "FamiliarAvatar",
        dependencies: avatarDependencies,
        resources: [
            .copy("Resources")
        ],
        swiftSettings: avatarSwiftSettings,
        linkerSettings: [
            .linkedFramework("AppKit"),
            .linkedFramework("Metal"),
            .linkedFramework("MetalKit"),
            .linkedFramework("QuartzCore"),
            .linkedFramework("CoreGraphics"),
            .linkedFramework("Speech"),       // 5.4 STT: on-device SFSpeechRecognizer
            .linkedFramework("AVFoundation")  // 5.4 STT: AVAudioEngine mic tap
        ]
    )
]

// The proprietary Cubism renderer is added to the package ONLY when opted in, so
// the default graph never references the (absent) Cubism Core library or header.
if live2dEnabled {
    // Cubism Live2D native renderer: the vendored Cubism SDK for Native
    // Framework (C++/ObjC++ incl. its Metal renderer) + a pure-C bridge.
    // Only include/cubism_bridge.h is Swift-visible. The proprietary Core
    // static lib is linked by absolute path. ARC is disabled to match the
    // framework's Metal renderer. The Metal shaders are compiled at runtime
    // (see CubismShaderInject.h) since the CLT ship no offline metallib tool.
    targets.append(
        .target(
            name: "CubismLive2D",
            exclude: [
                "framework/Rendering/CubismClippingManager.tpp"
            ],
            cxxSettings: [
                .headerSearchPath("framework"),
                .headerSearchPath("core"),
                .unsafeFlags(["-fno-objc-arc", "-w"])
            ],
            linkerSettings: [
                .linkedFramework("Metal"),
                .linkedFramework("MetalKit"),
                .linkedFramework("Foundation"),
                .unsafeFlags([
                    "-L\(packageDir)/Vendor/Live2DCore/lib",
                    "-lLive2DCubismCore"
                ])
            ]
        )
    )
}

let package = Package(
    name: "FamiliarAvatar",
    platforms: [
        .macOS(.v13)
    ],
    targets: targets,
    // Swift 5 concurrency model: this is a self-contained main-thread GUI app with
    // one background socket reader that hops to the main queue — the Swift 6 strict
    // actor-isolation checks add no safety here, only @MainActor plumbing noise.
    swiftLanguageModes: [.v5],
    cxxLanguageStandard: .cxx11
)
