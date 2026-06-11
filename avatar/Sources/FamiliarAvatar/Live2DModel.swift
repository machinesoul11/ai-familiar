import Foundation
import Metal
import CubismLive2D

/// Swift wrapper over the Cubism `cubism_bridge` for a Live2D character pack —
/// the Live2D sibling to `SpineModel`. Unlike Spine (where our Swift renderer
/// owns the GPU pipeline and the bridge only emits mesh buffers), the Cubism
/// framework renders *itself*: this wrapper owns the model handle and the
/// framework drives all the Metal work inside `draw`. `MetalCubismRenderer`
/// hands it the per-frame command buffer + render pass.
///
/// The token → expression/motion decision lives in the **config** `states`
/// (data), exactly like `SpineModel` — Live2D states carry an `expression` (the
/// persistent mood layer) and/or a `motion` (a one-shot gesture group). The
/// model also runs an autonomous idle motion + breath + eye-blink underneath.
final class Live2DModel: AvatarModel {
    private let handle: OpaquePointer
    private let config: CharacterConfig

    /// The expression currently set, so a resent phase doesn't restart it (a
    /// motion gesture, by contrast, re-fires on every command — like Spine's
    /// non-looping states).
    private var lastExpression: String = ""

    /// - Parameters:
    ///   - viewW/viewH: initial drawable size, used to size the Cubism mask
    ///     offscreen targets. The real per-frame size is passed again in `draw`.
    init?(character: ResolvedCharacter, device: MTLDevice, viewW: Int32, viewH: Int32) {
        guard let modelFile = character.config.assets.model else {
            FileHandle.standardError.write(Data("[avatar] live2d renderer needs assets.model (the *.model3.json)\n".utf8))
            return nil
        }
        // The bridge expects a directory ending in '/' plus the bare json name.
        let base = character.directory.path
        let dir = base.hasSuffix("/") ? base : base + "/"

        let devPtr = UnsafeRawPointer(Unmanaged.passUnretained(device as AnyObject).toOpaque())
        cubism_global_init(devPtr) // idempotent

        guard let h = dir.withCString({ d in
            modelFile.withCString { j in
                cubism_model_create(d, j, devPtr, viewW, viewH)
            }
        }) else {
            FileHandle.standardError.write(Data("[avatar] failed to load Live2D model \(dir)\(modelFile)\n".utf8))
            return nil
        }
        handle = h
        config = character.config

        // Config-driven placement (defaults reproduce the centered Step-1 fit).
        cubism_model_set_placement(h,
                                   Float(character.config.scale ?? 1.0),
                                   Float(character.config.offsetX ?? 0.0),
                                   Float(character.config.offsetY ?? 0.0))
    }

    deinit {
        cubism_model_destroy(handle)
    }

    /// Advance motion + physics + pose, then recompute the model.
    func update(_ deltaSeconds: Float) {
        cubism_model_update(handle, deltaSeconds)
    }

    /// Draw into the caller's render pass (Metal objects pass as opaque pointers).
    func draw(commandBuffer: UnsafeRawPointer, renderPass: UnsafeRawPointer, width: Int32, height: Int32) {
        cubism_model_draw(handle, commandBuffer, renderPass, width, height)
    }

    // MARK: - Semantic token -> config state (parallels SpineModel.apply)

    func apply(_ command: AvatarCommand) {
        switch command {
        case let .state(phase, ready):
            // The attention beacon takes precedence over the activity phase on the
            // single mood layer; combining them is a 4.2c wiring policy decision.
            play(ready ? "ready" : phase)
        case let .expression(mood):
            play(mood)
        case .thought:
            break // inner-thought DISPLAY is Phase 4.3; the overlay ignores it here
        }
    }

    private func play(_ stateKey: String) {
        guard let state = config.states[stateKey] else { return } // unknown token: ignore

        if let expression = state.expression, expression != lastExpression {
            expression.withCString { cubism_model_set_expression(handle, $0) }
            lastExpression = expression
        }
        // Gestures re-fire on every matching command (one-shots, like Spine).
        if let motion = state.motion {
            let index = Int32(state.motionIndex ?? 0)
            motion.withCString { cubism_model_start_motion(handle, $0, index) }
        }
    }
}
