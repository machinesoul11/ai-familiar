// Live2DSpike — Step-0 de-risk spike (throwaway).
//
// Renders the free Cubism "Haru" sample in a plain Metal window to prove three
// things on this toolchain BEFORE integrating Live2D into the real overlay:
//   1. the proprietary Core static lib links,
//   2. SwiftPM builds the mixed C++/Objective-C++ Cubism framework,
//   3. the Cubism Metal shaders compile + render at runtime (CLT, no Xcode).
//
// Not the desk pet: opaque background, plain window, hand-run. If Haru appears
// and breathes, the spike has done its job.

import AppKit
import MetalKit
import CubismLive2D
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// MARK: - Shader source injection

/// The Cubism Metal renderer normally loads a prebuilt MetalShaders.metallib.
/// We compile the .metal *source* at runtime instead (see CubismShaderInject.h),
/// so build the combined source here (inlining MetalShaderTypes.h, since runtime
/// compilation has no include path) and hand it to the bridge.
func injectShaderSource() {
    guard
        let metalURL = Bundle.module.url(forResource: "MetalShaders", withExtension: "metal", subdirectory: "Resources"),
        let typesURL = Bundle.module.url(forResource: "MetalShaderTypes.h", withExtension: "txt", subdirectory: "Resources"),
        let metalSrc = try? String(contentsOf: metalURL, encoding: .utf8),
        let typesSrc = try? String(contentsOf: typesURL, encoding: .utf8)
    else {
        FileHandle.standardError.write(Data("[spike] could not read bundled shader source\n".utf8))
        return
    }
    // Replace the local include with the header's contents (system includes stay).
    let combined = metalSrc.replacingOccurrences(of: "#include \"MetalShaderTypes.h\"", with: typesSrc)
    combined.withCString { cubism_set_metal_shader_source($0) }
}

// MARK: - Renderer

final class HaruRenderer: NSObject, MTKViewDelegate {
    private let device: MTLDevice
    private let queue: MTLCommandQueue
    private var model: OpaquePointer?
    private var lastTime: CFTimeInterval = CACurrentMediaTime()
    private let modelDir: String
    private let modelJson: String

    init?(view: MTKView, modelDir: String, modelJson: String) {
        guard let dev = view.device, let q = dev.makeCommandQueue() else { return nil }
        self.device = dev
        self.queue = q
        self.modelDir = modelDir
        self.modelJson = modelJson
        super.init()

        let devPtr = UnsafeRawPointer(Unmanaged.passUnretained(dev as AnyObject).toOpaque())
        cubism_global_init(devPtr)

        let size = view.drawableSize
        let w = Int32(max(size.width, 1))
        let h = Int32(max(size.height, 1))
        model = modelDir.withCString { d in
            modelJson.withCString { j in
                cubism_model_create(d, j, devPtr, w, h)
            }
        }
        if model == nil {
            FileHandle.standardError.write(Data("[spike] FAILED to load model \(modelDir)\(modelJson)\n".utf8))
        } else {
            FileHandle.standardError.write(Data("[spike] loaded \(modelDir)\(modelJson)\n".utf8))
        }
    }

    deinit {
        if let m = model { cubism_model_destroy(m) }
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard
            let model,
            let rpd = view.currentRenderPassDescriptor,
            let drawable = view.currentDrawable,
            let cmd = queue.makeCommandBuffer()
        else { return }

        let now = CACurrentMediaTime()
        let dt = Float(min(max(now - lastTime, 0), 0.1))
        lastTime = now

        cubism_model_update(model, dt)

        // Match the Cubism SDK Metal sample: clear the drawable in its own
        // encoder, then let Cubism render with Load. The Cubism renderer switches
        // descriptors while building mask/model offscreens, so the descriptor it
        // receives must preserve the already-cleared drawable when it composites
        // the final model render target back to the screen.
        if let clearEncoder = cmd.makeRenderCommandEncoder(descriptor: rpd) {
            clearEncoder.endEncoding()
        }
        rpd.colorAttachments[0].loadAction = .load

        let size = view.drawableSize
        let w = Int32(size.width)
        let h = Int32(size.height)
        let cmdPtr = UnsafeRawPointer(Unmanaged.passUnretained(cmd as AnyObject).toOpaque())
        let rpdPtr = UnsafeRawPointer(Unmanaged.passUnretained(rpd).toOpaque())
        cubism_model_draw(model, cmdPtr, rpdPtr, w, h)

        cmd.present(drawable)
        cmd.commit()
    }
}

// MARK: - Snapshot mode (offscreen render -> PNG, so the renderer can be
// inspected without a human watching the live window).

func writePNG(_ texture: MTLTexture, to path: String) {
    let w = texture.width, h = texture.height
    let rowBytes = w * 4
    var bytes = [UInt8](repeating: 0, count: rowBytes * h)
    texture.getBytes(&bytes, bytesPerRow: rowBytes,
                     from: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0)
    let cs = CGColorSpaceCreateDeviceRGB()
    // bgra8Unorm in memory == ARGB little-endian.
    let info = CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    guard
        let ctx = CGContext(data: &bytes, width: w, height: h, bitsPerComponent: 8,
                            bytesPerRow: rowBytes, space: cs, bitmapInfo: info),
        let cg = ctx.makeImage(),
        let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL,
                                                   UTType.png.identifier as CFString, 1, nil)
    else {
        FileHandle.standardError.write(Data("[spike] PNG encode failed\n".utf8)); return
    }
    CGImageDestinationAddImage(dest, cg, nil)
    CGImageDestinationFinalize(dest)
    FileHandle.standardError.write(Data("[spike] wrote \(path)\n".utf8))
}

func runSnapshot(modelDir: String, modelJson: String, outPath: String, frames: Int) {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
        FileHandle.standardError.write(Data("[spike] no metal device\n".utf8)); exit(1)
    }
    let w = 600, h = 800

    let devPtr = UnsafeRawPointer(Unmanaged.passUnretained(device as AnyObject).toOpaque())
    cubism_global_init(devPtr)
    let model = modelDir.withCString { d in modelJson.withCString { j in
        cubism_model_create(d, j, devPtr, Int32(w), Int32(h)) } }
    guard let model else { FileHandle.standardError.write(Data("[spike] load failed\n".utf8)); exit(1) }

    let colorDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: w, height: h, mipmapped: false)
    colorDesc.usage = [.renderTarget, .shaderRead]
    colorDesc.storageMode = .shared
    let colorTex = device.makeTexture(descriptor: colorDesc)!

    let depthDesc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .depth32Float, width: w, height: h, mipmapped: false)
    depthDesc.usage = [.renderTarget]
    depthDesc.storageMode = .private
    let depthTex = device.makeTexture(descriptor: depthDesc)!

    for i in 0..<max(frames, 1) {
        let rpd = MTLRenderPassDescriptor()
        rpd.colorAttachments[0].texture = colorTex
        rpd.colorAttachments[0].loadAction = .clear
        rpd.colorAttachments[0].storeAction = .store
        rpd.colorAttachments[0].clearColor = MTLClearColorMake(0.12, 0.12, 0.14, 1.0)
        rpd.depthAttachment.texture = depthTex
        rpd.depthAttachment.loadAction = .clear
        rpd.depthAttachment.storeAction = .dontCare
        rpd.depthAttachment.clearDepth = 1.0

        cubism_model_update(model, 1.0 / 60.0)

        guard let cmd = queue.makeCommandBuffer() else { continue }
        if let clear = cmd.makeRenderCommandEncoder(descriptor: rpd) { clear.endEncoding() }
        rpd.colorAttachments[0].loadAction = .load
        let cmdPtr = UnsafeRawPointer(Unmanaged.passUnretained(cmd as AnyObject).toOpaque())
        let rpdPtr = UnsafeRawPointer(Unmanaged.passUnretained(rpd).toOpaque())
        cubism_model_draw(model, cmdPtr, rpdPtr, Int32(w), Int32(h))
        cmd.commit()
        cmd.waitUntilCompleted()
        _ = i
    }

    writePNG(colorTex, to: outPath)
    cubism_model_destroy(model)
    exit(0)
}

// MARK: - App bootstrap

func resolveModel() -> (dir: String, json: String) {
    var args = Array(CommandLine.arguments.dropFirst())
    var dir: String? = nil
    var json = "Haru.model3.json"
    while let a = args.first {
        args.removeFirst()
        switch a {
        case "--model": if let v = args.first { dir = v; args.removeFirst() }
        case "--json":  if let v = args.first { json = v; args.removeFirst() }
        default: break
        }
    }
    // Default: characters/haru relative to the current directory (run from avatar/).
    let resolved = dir ?? FileManager.default.currentDirectoryPath + "/characters/haru"
    let withSlash = resolved.hasSuffix("/") ? resolved : resolved + "/"
    return (withSlash, json)
}

injectShaderSource()

// Headless snapshot mode: render a frame to a PNG and exit (no window).
if let snapIdx = CommandLine.arguments.firstIndex(of: "--snapshot") {
    let outPath = CommandLine.arguments.indices.contains(snapIdx + 1) ? CommandLine.arguments[snapIdx + 1] : "/tmp/haru.png"
    var frames = 30
    if let fIdx = CommandLine.arguments.firstIndex(of: "--frames"),
       CommandLine.arguments.indices.contains(fIdx + 1), let n = Int(CommandLine.arguments[fIdx + 1]) {
        frames = n
    }
    let (mDir, mJson) = resolveModel()
    runSnapshot(modelDir: mDir, modelJson: mJson, outPath: outPath, frames: frames)
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)

let frame = NSRect(x: 0, y: 0, width: 600, height: 800)
let window = NSWindow(
    contentRect: frame,
    styleMask: [.titled, .closable, .resizable],
    backing: .buffered,
    defer: false
)
window.title = "Live2D Spike — Haru"
window.center()

let mtkView = MTKView(frame: frame, device: MTLCreateSystemDefaultDevice())
mtkView.colorPixelFormat = .bgra8Unorm
mtkView.depthStencilPixelFormat = .depth32Float
mtkView.clearColor = MTLClearColorMake(0.12, 0.12, 0.14, 1.0) // opaque dark so Haru is visible
mtkView.preferredFramesPerSecond = 60

let (modelDir, modelJson) = resolveModel()
guard let renderer = HaruRenderer(view: mtkView, modelDir: modelDir, modelJson: modelJson) else {
    FileHandle.standardError.write(Data("[spike] renderer init failed\n".utf8))
    exit(1)
}
mtkView.delegate = renderer

window.contentView = mtkView
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
app.run()
