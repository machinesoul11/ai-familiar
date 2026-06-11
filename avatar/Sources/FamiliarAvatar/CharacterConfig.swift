import Foundation

/// A character pack: the assets + the semantic-token → animation mapping, loaded
/// from a `*.config.json` so swapping characters needs no rebuild. This is the
/// "character is data, not code" move — the daemon emits semantic tokens
/// (idle/working/blocked/done/ready/happy/thinking/alert) and the pack decides
/// which authored animation each one plays, whether it loops, and what to fall
/// back to. Schema (matches the Valerie config), e.g.:
///
///   {
///     "id": "valerie", "name": "Valerie", "scale": 1.0, "defaultAnimation": "idle",
///     "assets": { "skeleton": "valerie-pro.skel", "atlas": "valerie.atlas" },
///     "states": {
///       "idle":    { "animation": "idle",      "loop": true },
///       "working": { "animation": "typing",    "loop": true },
///       "done":    { "animation": "smile",     "loop": false, "fallback": "idle" }
///     }
///   }
///
/// Asset values are filenames resolved relative to the config file's folder (an
/// absolute path is used as-is). The texture is named by the .atlas itself, so it
/// isn't required here.
struct CharacterConfig: Decodable {
    struct Assets: Decodable {
        // Spine assets (required by the "spine" renderer).
        let skeleton: String?
        let atlas: String?
        let texture: String?
        // Live2D asset (required by the "live2d" renderer): the *.model3.json
        // entry file. Cubism resolves its own textures/motions/physics from there.
        let model: String?
    }
    /// One semantic token's reaction. Each renderer reads its own fields:
    ///  - Spine: `animation` (+ `loop`/`fallback`).
    ///  - Live2D: `expression` (the persistent mood, a model3.json Expression
    ///    `Name`) and/or `motion` (a one-shot gesture, a model3.json Motions
    ///    group). A renderer ignores the other's fields — one schema, no
    ///    renderer-tagged union until a third renderer needs it.
    struct State: Decodable {
        let animation: String?
        let loop: Bool?
        let fallback: String?
        let expression: String?
        let motion: String?
    }

    let id: String?
    let name: String?
    /// Which renderer backend draws this pack: "spine" (default when absent) or
    /// "live2d". A pack picks its renderer; the rest of the overlay (window, pet
    /// mode, drag, hotkeys, socket) is renderer-agnostic.
    let renderer: String?
    let scale: Double?
    /// Live2D placement: shift the model in the projection (normalized device
    /// coords, +y up). Absent ⇒ 0 (the renderer's centered fit). Spine uses its
    /// own bounds-fit and ignores these.
    let offsetX: Double?
    let offsetY: Double?
    let defaultAnimation: String?
    let assets: Assets
    let states: [String: State]
}

/// A resolved character: its config plus the directory its asset filenames are
/// relative to.
struct ResolvedCharacter {
    let config: CharacterConfig
    let directory: URL

    func assetPath(_ filename: String) -> String {
        if (filename as NSString).isAbsolutePath { return filename }
        return directory.appendingPathComponent(filename).path
    }

    /// Resolution order:
    ///   1. an explicit `--character <dir>`
    ///   2. `$FAMILIAR_HOME/character/` (drop a pack there, no flag, no rebuild)
    ///   3. the bundled spineboy default
    static func resolve(option dir: String?) -> ResolvedCharacter? {
        if let dir {
            let url = URL(fileURLWithPath: dir, isDirectory: true)
            if let resolved = load(in: url) { return resolved }
            FileHandle.standardError.write(Data("[avatar] no *.config.json in \(dir); falling back\n".utf8))
        }

        let home = ProcessInfo.processInfo.environment["FAMILIAR_HOME"]
            ?? (NSHomeDirectory() as NSString).appendingPathComponent(".familiar")
        let famDir = URL(fileURLWithPath: home).appendingPathComponent("character", isDirectory: true)
        if let resolved = load(in: famDir) { return resolved }

        if let bundled = Bundle.module.url(forResource: "spineboy.config", withExtension: "json", subdirectory: "Resources"),
           let config = decode(bundled) {
            return ResolvedCharacter(config: config, directory: bundled.deletingLastPathComponent())
        }
        return nil
    }

    private static func load(in directory: URL) -> ResolvedCharacter? {
        let fm = FileManager.default
        var candidates = [directory.appendingPathComponent("character.json")]
        if let items = try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
            candidates += items.filter { $0.lastPathComponent.hasSuffix(".config.json") }.sorted { $0.path < $1.path }
        }
        for url in candidates where fm.fileExists(atPath: url.path) {
            if let config = decode(url) {
                return ResolvedCharacter(config: config, directory: directory)
            }
        }
        return nil
    }

    private static func decode(_ url: URL) -> CharacterConfig? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(CharacterConfig.self, from: data)
    }
}
