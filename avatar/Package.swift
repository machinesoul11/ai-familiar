// swift-tools-version: 6.0
import PackageDescription

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
            dependencies: ["CSpine"],
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
        )
    ],
    // Swift 5 concurrency model: this is a self-contained main-thread GUI app with
    // one background socket reader that hops to the main queue — the Swift 6 strict
    // actor-isolation checks add no safety here, only @MainActor plumbing noise.
    swiftLanguageModes: [.v5],
    cxxLanguageStandard: .cxx11
)
