import AppKit
import MetalKit
import Foundation

// Parsed launch options. Everything has a sensible default so the app runs with
// no arguments; the harness/daemon flags are for by-eye driving.
struct Options {
    var socketPath: String
    var monitorIndex: Int
    var startLocked: Bool
    var windowSize: CGFloat
    var characterDir: String?

    static func parse() -> Options {
        let env = ProcessInfo.processInfo.environment
        let home = env["FAMILIAR_HOME"]
            ?? (NSHomeDirectory() as NSString).appendingPathComponent(".familiar")
        var opts = Options(
            socketPath: (home as NSString).appendingPathComponent("avatar.sock"),
            monitorIndex: 1,          // monitor-2 default (dual-display setup)
            startLocked: false,
            windowSize: 360,
            characterDir: nil
        )
        var args = Array(CommandLine.arguments.dropFirst())
        while let arg = args.first {
            args.removeFirst()
            switch arg {
            case "--socket":      if let v = args.first { opts.socketPath = v; args.removeFirst() }
            case "--monitor":     if let v = args.first, let n = Int(v) { opts.monitorIndex = n; args.removeFirst() }
            case "--size":        if let v = args.first, let n = Double(v) { opts.windowSize = CGFloat(n); args.removeFirst() }
            case "--character":   if let v = args.first { opts.characterDir = v; args.removeFirst() }
            case "--locked":        opts.startLocked = true
            case "--click-through": break   // deprecated: pass-through is now the default
            case "--help", "-h":
                print("""
                FamiliarAvatar — native desk-pet overlay (subscribes to avatar.sock)
                  --socket <path>     Unix socket to subscribe to (default $FAMILIAR_HOME/avatar.sock)
                  --monitor <n>       0-based display index (default 1 = monitor-2)
                  --size <points>     square window edge (default 360)
                  --character <dir>   character pack folder (a *.config.json + assets);
                                      else $FAMILIAR_HOME/character/, else bundled spineboy
                  --locked            start engaged+locked (interactive, no auto-release)
                  --click-through     deprecated (pass-through is the default now)
                Pass-through by default: clicks reach apps behind her. DOUBLE-CLICK her
                body to engage (drag to move); she auto-releases ~4 s after you stop.
                Hotkeys (global keyboard monitor needs Accessibility permission):
                  ⌃⌥⌘P  lock/unlock engaged    ⌃⌥⌘Q  quit
                """)
                exit(0)
            default:
                break
            }
        }
        return opts
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let options: Options
    private var window: OverlayWindow!
    private var renderer: (any MTKViewDelegate)?
    private var subscriber: SocketSubscriber!
    private var model: (any AvatarModel)!
    private var monitors: [Any] = []
    private var engagement: EngagementController!

    init(options: Options) {
        self.options = options
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let character = ResolvedCharacter.resolve(option: options.characterDir) else {
            fail("no character pack found (and bundled spineboy missing)")
            return
        }

        // Place a square window near the bottom-right of the chosen display.
        let screens = NSScreen.screens
        let actualIndex = screens.indices.contains(options.monitorIndex) ? options.monitorIndex : 0
        let screen = screens.indices.contains(actualIndex) ? screens[actualIndex] : (screens.first ?? NSScreen.main!)
        let edge = options.windowSize
        let vf = screen.visibleFrame
        let origin = NSPoint(x: vf.maxX - edge - 40, y: vf.minY + 40)
        let frame = NSRect(origin: origin, size: NSSize(width: edge, height: edge))

        window = OverlayWindow(contentRect: frame)
        let view = DraggableMetalView(frame: NSRect(origin: .zero, size: frame.size),
                                      device: MTLCreateSystemDefaultDevice())

        // Pick the renderer backend from the pack's config. Each path is
        // self-contained (Spine emits meshes our renderer draws; Cubism renders
        // itself) — only this seam and AvatarModel.apply are shared.
        guard buildRenderer(character: character, view: view) else {
            fail("failed to load character '\(character.config.id ?? "?")' (renderer '\(character.config.renderer ?? "spine")') from \(character.directory.path)")
            return
        }
        view.delegate = renderer
        window.contentView = view
        window.orderFrontRegardless()

        FileHandle.standardError.write(Data("[avatar] character: \(character.config.name ?? character.config.id ?? "?") (\(character.directory.lastPathComponent)) — renderer \(character.config.renderer ?? "spine")\n".utf8))

        // Pass-through by default; double-click her body to engage. Hit-region
        // insets are tunable per character (data, not code).
        engagement = EngagementController(
            window: window,
            view: view,
            hitInsetX: CGFloat(character.config.hitInsetX ?? 0.20),
            hitInsetY: CGFloat(character.config.hitInsetY ?? 0.06)
        )
        engagement.start()
        if options.startLocked { engagement.toggleLock() }

        subscriber = SocketSubscriber(path: options.socketPath) { [weak self] command in
            self?.model.apply(command)
        }
        subscriber.start()

        installHotkeys()

        let screenNote = actualIndex == options.monitorIndex ? "display \(actualIndex)" : "display \(actualIndex) (requested \(options.monitorIndex), not present)"
        FileHandle.standardError.write(Data("""
        [avatar] running on \(screenNote) of \(screens.count) — pass-through (double-click to engage\(options.startLocked ? "; started locked" : ""))
        [avatar] subscribing to \(options.socketPath)
        \n
        """.utf8))
    }

    /// Build the model + renderer for the pack's chosen backend, storing both on
    /// self. Returns false if the pack can't be loaded for that renderer.
    private func buildRenderer(character: ResolvedCharacter, view: DraggableMetalView) -> Bool {
        switch character.config.renderer {
        case "live2d":
            injectCubismShaderSource() // runtime-compile the Cubism Metal shaders (CLT, no metallib)
            guard let r = MetalCubismRenderer(view: view, character: character) else { return false }
            self.model = r.model
            self.renderer = r
            return true
        default: // "spine" or absent — the bundled default
            guard let m = SpineModel(character: character),
                  let r = MetalSpineRenderer(view: view, model: m) else { return false }
            self.model = m
            self.renderer = r
            return true
        }
    }

    private func installHotkeys() {
        let handler: (NSEvent) -> Void = { [weak self] event in
            guard let self else { return }
            let flags = event.modifierFlags.intersection([.control, .option, .command])
            guard flags == [.control, .option, .command] else { return }
            switch event.charactersIgnoringModifiers {
            case "p": self.engagement.toggleLock()
            case "q": NSApp.terminate(nil)
            default: break
            }
        }
        if let g = NSEvent.addGlobalMonitorForEvents(matching: .keyDown, handler: handler) { monitors.append(g) }
        if let l = NSEvent.addLocalMonitorForEvents(matching: .keyDown, handler: { handler($0); return $0 }) { monitors.append(l) }
    }

    private func fail(_ message: String) {
        FileHandle.standardError.write(Data("[avatar] FATAL: \(message)\n".utf8))
        NSApp.terminate(nil)
    }
}

let options = Options.parse()
let app = NSApplication.shared
app.setActivationPolicy(.accessory) // no Dock icon — it's a desk pet
let delegate = AppDelegate(options: options)
app.delegate = delegate
app.run()
