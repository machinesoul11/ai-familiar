import MetalKit
import simd
import CSpine

/// Draws the spineboy skeleton each frame into a transparent MTKView. Consumes
/// the flat draw commands from SpineModel/CSpine (interleaved verts + local
/// indices, one batch per atlas page + blend mode) and renders them with
/// premultiplied-alpha blending — which is exactly what a transparent
/// CAMetalLayer composites against the desktop.
final class MetalSpineRenderer: NSObject, MTKViewDelegate {
    private let device: MTLDevice
    private let queue: MTLCommandQueue
    private let model: SpineModel

    private var pipelineNormal: MTLRenderPipelineState!
    private var pipelineAdditive: MTLRenderPipelineState!
    private var sampler: MTLSamplerState!
    private var textures: [MTLTexture] = []

    private var lastTime: CFTimeInterval = CACurrentMediaTime()

    init?(view: MTKView, model: SpineModel) {
        guard let device = view.device ?? MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue() else { return nil }
        self.device = device
        self.queue = queue
        self.model = model
        super.init()

        view.device = device
        view.colorPixelFormat = .bgra8Unorm
        view.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        view.framebufferOnly = true
        view.layer?.isOpaque = false
        view.enableSetNeedsDisplay = false
        view.isPaused = false
        view.preferredFramesPerSecond = 60

        do {
            try buildPipelines(pixelFormat: view.colorPixelFormat)
        } catch {
            FileHandle.standardError.write(Data("[avatar] pipeline build failed: \(error)\n".utf8))
            return nil
        }
        buildSampler()
        loadTextures()
    }

    // MARK: - Setup

    private func buildPipelines(pixelFormat: MTLPixelFormat) throws {
        let source = """
        #include <metal_stdlib>
        using namespace metal;

        struct VIn  { float2 pos; float2 uv; float4 color; };
        struct VOut { float4 position [[position]]; float2 uv; float4 color; };

        vertex VOut v_main(const device VIn* verts [[buffer(0)]],
                           constant float4x4& mvp   [[buffer(1)]],
                           uint vid                 [[vertex_id]]) {
            VOut o;
            o.position = mvp * float4(verts[vid].pos, 0.0, 1.0);
            o.uv = verts[vid].uv;
            o.color = verts[vid].color;
            return o;
        }

        fragment float4 f_main(VOut in [[stage_in]],
                               texture2d<float> tex [[texture(0)]],
                               sampler s            [[sampler(0)]],
                               constant float& premul [[buffer(0)]]) {
            float4 t = tex.sample(s, in.uv);
            // The blend pipeline expects premultiplied output. A pma atlas is
            // already premultiplied (premul=0); a straight-alpha atlas isn't, so
            // premultiply it here (premul=1). The vertex tint is premultiplied too.
            if (premul > 0.5) { t = float4(t.rgb * t.a, t.a); }
            float4 vc = float4(in.color.rgb * in.color.a, in.color.a);
            return t * vc;
        }
        """

        let library = try device.makeLibrary(source: source, options: nil)
        let vfn = library.makeFunction(name: "v_main")
        let ffn = library.makeFunction(name: "f_main")

        func makePipeline(additive: Bool) throws -> MTLRenderPipelineState {
            let desc = MTLRenderPipelineDescriptor()
            desc.vertexFunction = vfn
            desc.fragmentFunction = ffn
            let att = desc.colorAttachments[0]!
            att.pixelFormat = pixelFormat
            att.isBlendingEnabled = true
            att.rgbBlendOperation = .add
            att.alphaBlendOperation = .add
            // premultiplied-alpha source
            att.sourceRGBBlendFactor = .one
            att.sourceAlphaBlendFactor = .one
            att.destinationRGBBlendFactor = additive ? .one : .oneMinusSourceAlpha
            att.destinationAlphaBlendFactor = additive ? .one : .oneMinusSourceAlpha
            return try device.makeRenderPipelineState(descriptor: desc)
        }

        pipelineNormal = try makePipeline(additive: false)
        pipelineAdditive = try makePipeline(additive: true)
    }

    private func buildSampler() {
        let desc = MTLSamplerDescriptor()
        desc.minFilter = .linear
        desc.magFilter = .linear
        desc.sAddressMode = .clampToEdge
        desc.tAddressMode = .clampToEdge
        sampler = device.makeSamplerState(descriptor: desc)
    }

    private func loadTextures() {
        let loader = MTKTextureLoader(device: device)
        let options: [MTKTextureLoader.Option: Any] = [
            .SRGB: false,
            .generateMipmaps: false,
            .origin: MTKTextureLoader.Origin.topLeft
        ]
        textures = (0..<model.pageCount).compactMap { i in
            let path = model.pagePath(i)
            let url = URL(fileURLWithPath: path)
            do {
                return try loader.newTexture(URL: url, options: options)
            } catch {
                FileHandle.standardError.write(Data("[avatar] texture load failed (\(path)): \(error)\n".utf8))
                return nil
            }
        }
    }

    // MARK: - Projection

    /// Orthographic projection that centers the character's setup-pose bounds and
    /// fits it to ~85% of the view height, preserving aspect.
    private func projection(viewSize: CGSize) -> simd_float4x4 {
        let b = model.bounds
        let aspect = viewSize.height > 0 ? Float(viewSize.width / viewSize.height) : 1
        let fit: Float = min(0.97, 0.85 * model.scale) // config scale: larger = bigger character
        let visH = max(b.h, 1) / fit
        let visW = visH * aspect
        let cx = b.x + b.w / 2
        let cy = b.y + b.h / 2
        let l = cx - visW / 2, r = cx + visW / 2
        let bot = cy - visH / 2, top = cy + visH / 2

        let c0 = SIMD4<Float>(2 / (r - l), 0, 0, 0)
        let c1 = SIMD4<Float>(0, 2 / (top - bot), 0, 0)
        let c2 = SIMD4<Float>(0, 0, 1, 0)
        let c3 = SIMD4<Float>(-(r + l) / (r - l), -(top + bot) / (top - bot), 0, 1)
        return simd_float4x4(columns: (c0, c1, c2, c3))
    }

    // MARK: - MTKViewDelegate

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        let now = CACurrentMediaTime()
        let dt = Float(min(max(now - lastTime, 0), 0.1)) // clamp to avoid jumps after a stall
        lastTime = now

        let commands = model.frame(deltaSeconds: dt)

        guard let drawable = view.currentDrawable,
              let passDescriptor = view.currentRenderPassDescriptor,
              let commandBuffer = queue.makeCommandBuffer(),
              let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: passDescriptor)
        else { return }

        if !commands.isEmpty && !textures.isEmpty {
            // Flatten into one vertex buffer + one index buffer, rebasing each
            // command's local indices to global.
            var vertices: [SpineVertex] = []
            var indices: [UInt16] = []
            struct Batch { let indexStart: Int; let indexCount: Int; let page: Int; let blend: Int32 }
            var batches: [Batch] = []

            for cmd in commands {
                guard cmd.vertexCount > 0, cmd.indexCount > 0,
                      let vptr = cmd.vertices, let iptr = cmd.indices else { continue }
                let baseVertex = UInt16(truncatingIfNeeded: vertices.count)
                let vbuf = UnsafeBufferPointer(start: vptr, count: Int(cmd.vertexCount))
                vertices.append(contentsOf: vbuf)

                let indexStart = indices.count
                let ibuf = UnsafeBufferPointer(start: iptr, count: Int(cmd.indexCount))
                for idx in ibuf { indices.append(idx &+ baseVertex) }

                batches.append(Batch(indexStart: indexStart,
                                     indexCount: Int(cmd.indexCount),
                                     page: Int(cmd.texturePage),
                                     blend: cmd.blendMode))
            }

            if !batches.isEmpty,
               let vbuffer = device.makeBuffer(bytes: vertices,
                                               length: vertices.count * MemoryLayout<SpineVertex>.stride,
                                               options: .storageModeShared),
               let ibuffer = device.makeBuffer(bytes: indices,
                                               length: indices.count * MemoryLayout<UInt16>.stride,
                                               options: .storageModeShared) {
                var mvp = projection(viewSize: view.drawableSize)
                var premultiply: Float = model.isPMA ? 0 : 1
                encoder.setVertexBuffer(vbuffer, offset: 0, index: 0)
                encoder.setVertexBytes(&mvp, length: MemoryLayout<simd_float4x4>.size, index: 1)
                encoder.setFragmentBytes(&premultiply, length: MemoryLayout<Float>.size, index: 0)
                encoder.setFragmentSamplerState(sampler, index: 0)

                for batch in batches {
                    guard batch.page >= 0, batch.page < textures.count else { continue }
                    let additive = batch.blend == SpineBlendAdditive.rawValue
                    encoder.setRenderPipelineState(additive ? pipelineAdditive : pipelineNormal)
                    encoder.setFragmentTexture(textures[batch.page], index: 0)
                    encoder.drawIndexedPrimitives(type: .triangle,
                                                  indexCount: batch.indexCount,
                                                  indexType: .uint16,
                                                  indexBuffer: ibuffer,
                                                  indexBufferOffset: batch.indexStart * MemoryLayout<UInt16>.stride)
                }
            }
        }

        encoder.endEncoding()
        commandBuffer.present(drawable)
        commandBuffer.commit()
    }
}
