import MetalKit
import CubismLive2D

/// The Live2D sibling to `MetalSpineRenderer`: an `MTKViewDelegate` that drives a
/// `Live2DModel` each frame and lets the Cubism framework composite itself into
/// the **transparent** overlay drawable. The de-risk snapshot confirmed Cubism
/// writes correct straight-alpha (corner α≈0, model α high), so the desktop
/// shows through exactly like the Spine path.
///
/// Differences from the Spine renderer, all driven by how Cubism renders:
///  - a depth attachment (`depth32Float`) — Cubism uses depth; the Spine path
///    doesn't, so each renderer configures the view it is handed,
///  - the clear-then-`.load` dance: clear the drawable to transparent in its own
///    encoder, then let Cubism render with `loadAction = .load` so its mask /
///    model offscreen passes don't wipe the cleared drawable.
final class MetalCubismRenderer: NSObject, MTKViewDelegate {
    private let queue: MTLCommandQueue
    let model: Live2DModel

    private var lastTime: CFTimeInterval = CACurrentMediaTime()

    init?(view: MTKView, character: ResolvedCharacter) {
        guard let device = view.device ?? MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue() else { return nil }
        self.queue = queue

        view.device = device
        view.colorPixelFormat = .bgra8Unorm
        view.depthStencilPixelFormat = .depth32Float
        view.clearColor = MTLClearColorMake(0, 0, 0, 0) // transparent overlay
        view.framebufferOnly = true
        view.layer?.isOpaque = false
        view.enableSetNeedsDisplay = false
        view.isPaused = false
        view.preferredFramesPerSecond = 60

        // Size the Cubism mask targets from the drawable (re-passed per frame).
        let size = view.drawableSize
        let w = Int32(max(size.width, 1))
        let h = Int32(max(size.height, 1))
        guard let model = Live2DModel(character: character, device: device, viewW: w, viewH: h) else {
            return nil
        }
        self.model = model
        super.init()
    }

    // MARK: - MTKViewDelegate

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard let rpd = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable,
              let cmd = queue.makeCommandBuffer()
        else { return }

        let now = CACurrentMediaTime()
        let dt = Float(min(max(now - lastTime, 0), 0.1)) // clamp after a stall
        lastTime = now

        model.update(dt)

        // Clear the (transparent) drawable in its own encoder, then hand Cubism a
        // descriptor that preserves it (.load) while it composites its final
        // model render target back to the screen.
        if let clearEncoder = cmd.makeRenderCommandEncoder(descriptor: rpd) {
            clearEncoder.endEncoding()
        }
        rpd.colorAttachments[0].loadAction = .load

        let size = view.drawableSize
        let cmdPtr = UnsafeRawPointer(Unmanaged.passUnretained(cmd as AnyObject).toOpaque())
        let rpdPtr = UnsafeRawPointer(Unmanaged.passUnretained(rpd).toOpaque())
        model.draw(commandBuffer: cmdPtr, renderPass: rpdPtr,
                   width: Int32(size.width), height: Int32(size.height))

        cmd.present(drawable)
        cmd.commit()
    }
}

/// Compile the Cubism Metal shaders at runtime from bundled source (the CLT have
/// no offline metallib compiler — see the Step-0 spike). Call once before
/// creating any `Live2DModel`. Inlines `MetalShaderTypes.h` into the `.metal`
/// source since runtime compilation has no include path.
func injectCubismShaderSource() {
    guard
        let metalURL = Bundle.module.url(forResource: "MetalShaders", withExtension: "metal", subdirectory: "Resources"),
        let typesURL = Bundle.module.url(forResource: "MetalShaderTypes.h", withExtension: "txt", subdirectory: "Resources"),
        let metalSrc = try? String(contentsOf: metalURL, encoding: .utf8),
        let typesSrc = try? String(contentsOf: typesURL, encoding: .utf8)
    else {
        FileHandle.standardError.write(Data("[avatar] could not read bundled Cubism shader source\n".utf8))
        return
    }
    let combined = metalSrc.replacingOccurrences(of: "#include \"MetalShaderTypes.h\"", with: typesSrc)
    combined.withCString { cubism_set_metal_shader_source($0) }
}
