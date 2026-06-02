import Foundation
import CSpine

/// Swift wrapper over the CSpine bridge. Owns the spine instance, exposes the
/// per-frame draw commands, and — crucially — holds the **renderer-side semantic
/// token → model-state mapping**. Per the avatar protocol's renderer-agnostic
/// invariant, the daemon emits only semantic tokens (phase/mood/ready); deciding
/// which spineboy animation each token plays lives HERE, not in the daemon. Swap
/// the character or runtime and only this mapping changes.
final class SpineModel {
    private let handle: OpaquePointer
    private(set) var pageCount: Int
    private var lastBasePhase: String = ""

    /// Setup-pose bounds in skeleton units (x, y, width, height), for placement.
    let bounds: (x: Float, y: Float, w: Float, h: Float)

    init?(skelPath: String, atlasPath: String) {
        guard let h = spine_create(skelPath, atlasPath) else { return nil }
        handle = h
        pageCount = Int(spine_page_count(h))

        var bx: Float = 0, by: Float = 0, bw: Float = 0, bh: Float = 0
        spine_get_bounds(h, &bx, &by, &bw, &bh)
        bounds = (bx, by, bw, bh)

        // Start in the resting state.
        spine_set_base_animation(h, "idle", true)
        lastBasePhase = "idle"
    }

    deinit {
        spine_destroy(handle)
    }

    /// Absolute path to atlas page `index`'s texture file (a PNG), for MTKTextureLoader.
    func pagePath(_ index: Int) -> String {
        String(cString: spine_page_path(handle, Int32(index)))
    }

    func pageSize(_ index: Int) -> (w: Int, h: Int) {
        (Int(spine_page_width(handle, Int32(index))), Int(spine_page_height(handle, Int32(index))))
    }

    /// Advance and produce this frame's draw commands (pointers valid until the
    /// next call).
    func frame(deltaSeconds: Float) -> [SpineDrawCommand] {
        var ptr: UnsafePointer<SpineDrawCommand>? = nil
        let count = Int(spine_update_and_render(handle, deltaSeconds, &ptr))
        guard count > 0, let base = ptr else { return [] }
        return Array(UnsafeBufferPointer(start: base, count: count))
    }

    // MARK: - Semantic token -> animation mapping (renderer-owned)

    func apply(_ command: AvatarCommand) {
        switch command {
        case let .state(phase, ready):
            applyPhase(phase)
            if ready { playOneShot("jump") } // the "your turn" attention beacon
        case let .expression(mood):
            applyMood(mood)
        case .thought:
            break // inner-thought DISPLAY is Phase 4.3; the overlay ignores it here
        }
    }

    /// phase -> looping base animation on track 0. Re-applying the same phase is a
    /// no-op so a resent state frame never restarts/jitters the loop.
    private func applyPhase(_ phase: String) {
        guard phase != lastBasePhase else { return }
        let animation: String
        switch phase {
        case "idle": animation = "idle"
        case "working": animation = "walk"
        case "blocked": animation = "aim"
        case "done": animation = "idle"
        default: return // unknown phase: ignore (forward-compat)
        }
        guard spine_has_animation(handle, animation) else { return }
        spine_set_base_animation(handle, animation, true)
        lastBasePhase = phase
    }

    /// mood -> one-shot overlay on track 1 (plays once, mixes back to the base).
    private func applyMood(_ mood: String) {
        let animation: String?
        switch mood {
        case "neutral": animation = nil
        case "happy": animation = "jump"
        case "thinking": animation = "idle-turn"
        case "alert": animation = "shoot"
        default: return // unknown mood: ignore (forward-compat)
        }
        if let animation { playOneShot(animation) }
    }

    private func playOneShot(_ name: String) {
        guard spine_has_animation(handle, name) else { return }
        spine_play_oneshot(handle, name)
    }
}
