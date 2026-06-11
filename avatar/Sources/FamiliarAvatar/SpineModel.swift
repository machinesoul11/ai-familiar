import Foundation
import CSpine

/// Swift wrapper over the CSpine bridge, driven by a CharacterConfig. The
/// renderer-side semantic-token → animation decision lives in the **config**
/// (data), not in code — per the avatar protocol's renderer-agnostic invariant.
/// This class just resolves each AvatarCommand to a config state and plays it.
final class SpineModel: AvatarModel {
    private let handle: OpaquePointer
    private let config: CharacterConfig
    private(set) var pageCount: Int
    let isPMA: Bool
    let scale: Float

    /// Setup-pose bounds in skeleton units (x, y, width, height), for placement.
    let bounds: (x: Float, y: Float, w: Float, h: Float)

    private var lastStateKey: String = ""

    init?(character: ResolvedCharacter) {
        guard let skelName = character.config.assets.skeleton,
              let atlasName = character.config.assets.atlas else {
            FileHandle.standardError.write(Data("[avatar] spine renderer needs assets.skeleton + assets.atlas\n".utf8))
            return nil
        }
        let skel = character.assetPath(skelName)
        let atlas = character.assetPath(atlasName)
        guard let h = spine_create(skel, atlas) else { return nil }
        handle = h
        config = character.config
        pageCount = Int(spine_page_count(h))
        isPMA = spine_is_pma(h)
        scale = Float(character.config.scale ?? 1.0)

        var bx: Float = 0, by: Float = 0, bw: Float = 0, bh: Float = 0
        spine_get_bounds(h, &bx, &by, &bw, &bh)
        bounds = (bx, by, bw, bh)

        let start = character.config.defaultAnimation ?? "idle"
        spine_play(h, start, true, nil)
        lastStateKey = start
    }

    deinit {
        spine_destroy(handle)
    }

    func pagePath(_ index: Int) -> String {
        String(cString: spine_page_path(handle, Int32(index)))
    }

    func frame(deltaSeconds: Float) -> [SpineDrawCommand] {
        var ptr: UnsafePointer<SpineDrawCommand>? = nil
        let count = Int(spine_update_and_render(handle, deltaSeconds, &ptr))
        guard count > 0, let base = ptr else { return [] }
        return Array(UnsafeBufferPointer(start: base, count: count))
    }

    // MARK: - Semantic token -> config state

    func apply(_ command: AvatarCommand) {
        switch command {
        case let .state(phase, ready):
            // `ready` (the attention beacon) takes precedence over the activity
            // phase on the single render track. Combining them is a 4.2c wiring
            // policy decision; for now last-write-wins.
            play(ready ? "ready" : phase)
        case let .expression(mood):
            play(mood)
        case .thought:
            break // thought has no animation; the renderer-agnostic ThoughtBubble overlay shows it (4.3)
        }
    }

    private func play(_ stateKey: String) {
        guard let state = config.states[stateKey], let animation = state.animation else { return } // unknown/animation-less token: ignore
        let loop = state.loop ?? true
        // De-dup only looping states so a resent phase doesn't restart/jitter the
        // loop; one-shots (a wave, an alert flash) re-trigger on every command.
        if loop && stateKey == lastStateKey { return }
        spine_play(handle, animation, loop, state.fallback)
        lastStateKey = stateKey
    }
}
