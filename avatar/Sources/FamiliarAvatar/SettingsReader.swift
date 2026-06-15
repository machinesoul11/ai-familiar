import Foundation

/// The avatar's read-only view of the daemon-owned `$FAMILIAR_HOME/settings.json`
/// store (Phase 6). The daemon is the single source of truth; the avatar is a
/// dumb renderer that READS its own presentation prefs (`scale` / `monitor` /
/// `character`) from the shared file — it never writes and decides nothing.
///
/// This is the Swift half of the cross-language `settings.json` contract pinned
/// in 6.1 (`src/settings.ts`). It mirrors `parseSettings`'s TOTALITY: the file
/// missing, malformed JSON, a non-object root, a missing/ wrong-typed `avatar`
/// sub-object, or any individual field of the wrong type all degrade to `nil`
/// (→ the caller's built-in default) per field, independently, never throwing.
/// An absent file ⇒ every field nil ⇒ byte-identical to today.
///
/// Read ONCE at launch (matching the daemon's resolve-at-use cheapness for a
/// once-per-process value); live push over the avatar socket is deferred.
struct AvatarSettings {
    /// User-facing window-size multiplier (default 1.0 ⇒ the base edge). Distinct
    /// from `CharacterConfig.scale`, which tunes the model's fit *inside* the
    /// window — this scales the window itself.
    var scale: Double?
    /// 1-based display number as written in settings.json (default 2 = "monitor-2",
    /// human-friendly). The caller converts to the 0-based `NSScreen` index.
    var monitor: Int?
    /// Character pack NAME (e.g. "haru") resolved against
    /// `$FAMILIAR_HOME/characters/<name>/` then `./characters/<name>/`; a value
    /// containing "/" is treated as a literal directory path. Empty ⇒ no
    /// preference (nil).
    var character: String?

    /// Total parse of `$FAMILIAR_HOME/settings.json`'s `avatar` sub-object. Any
    /// failure at any level → the corresponding field stays nil.
    static func load(home: String) -> AvatarSettings {
        let path = (home as NSString).appendingPathComponent("settings.json")
        guard let data = FileManager.default.contents(atPath: path),
              let root = try? JSONSerialization.jsonObject(with: data),
              let obj = root as? [String: Any],
              let avatar = obj["avatar"] as? [String: Any] else {
            return AvatarSettings()
        }
        var s = AvatarSettings()
        if let n = avatar["scale"] as? NSNumber { s.scale = n.doubleValue }
        if let n = avatar["monitor"] as? NSNumber { s.monitor = n.intValue }
        if let c = avatar["character"] as? String, !c.isEmpty { s.character = c }
        return s
    }
}
