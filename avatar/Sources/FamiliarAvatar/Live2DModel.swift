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
/// Step 1 is render-only: the model plays its authored idle motion + physics +
/// breath, and `apply` is a deliberate no-op — the token → expression/motion map
/// is Step 2.
final class Live2DModel: AvatarModel {
    private let handle: OpaquePointer

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

    // MARK: - AvatarModel

    func apply(_ command: AvatarCommand) {
        // Token → expression/motion mapping is Phase 4.5b Step 2. Step 1 renders
        // the idle/breath/physics loop only, so incoming commands are ignored.
    }
}
