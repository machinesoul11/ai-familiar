// swift-tools-version: 6.0
import PackageDescription
import Foundation

// Absolute path to this package, so the vendored Cubism Core static lib can be
// linked by absolute path (SwiftPM has no first-class "vendored static lib").
let packageDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path

let package = Package(
    name: "FamiliarAvatar",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
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
        .executableTarget(
            name: "FamiliarAvatar",
            dependencies: ["CSpine", "CubismLive2D"],
            resources: [
                .copy("Resources")
            ],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("Metal"),
                .linkedFramework("MetalKit"),
                .linkedFramework("QuartzCore"),
                .linkedFramework("CoreGraphics")
            ]
        ),

        // Cubism Live2D native renderer: the vendored Cubism SDK for Native
        // Framework (C++/ObjC++ incl. its Metal renderer) + a pure-C bridge.
        // Only include/cubism_bridge.h is Swift-visible. The proprietary Core
        // static lib is linked by absolute path. ARC is disabled to match the
        // framework's Metal renderer. The Metal shaders are compiled at runtime
        // (see CubismShaderInject.h) since the CLT ship no offline metallib tool.
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
        ),
        // Step-0 throwaway spike: render the free Haru sample in a plain Metal
        // window to de-risk Core linking + SwiftPM mixed C++/ObjC++ build +
        // runtime Metal shader compilation, before touching the real overlay.
        .executableTarget(
            name: "Live2DSpike",
            dependencies: ["CubismLive2D"],
            resources: [
                .copy("Resources")
            ],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("Metal"),
                .linkedFramework("MetalKit"),
                .linkedFramework("QuartzCore")
            ]
        )
    ],
    // Swift 5 concurrency model: this is a self-contained main-thread GUI app with
    // one background socket reader that hops to the main queue — the Swift 6 strict
    // actor-isolation checks add no safety here, only @MainActor plumbing noise.
    swiftLanguageModes: [.v5],
    cxxLanguageStandard: .cxx11
)
