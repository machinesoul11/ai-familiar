import AppKit
import MetalKit
import Foundation

// Parsed launch options. Everything has a sensible default so the app runs with
// no arguments; the harness/daemon flags are for by-eye driving.
struct Options {
    var socketPath: String
    var monitorIndex: Int
    var clickThrough: Bool
    var windowSize: CGFloat

    static func parse() -> Options {
        let env = ProcessInfo.processInfo.environment
        let home = env["FAMILIAR_HOME"]
            ?? (NSHomeDirectory() as NSString).appendingPathComponent(".familiar")
        var opts = Options(
            socketPath: (home as NSString).appendingPathComponent("avatar.sock"),
            monitorIndex: 1,          // monitor-2 default (dual-display setup)
            clickThrough: false,
            windowSize: 360
        )
        var args = Array(CommandLine.arguments.dropFirst())
        while let arg = args.first {
            args.removeFirst()
            switch arg {
            case "--socket":      if let v = args.first { opts.socketPath = v; args.removeFirst() }
            case "--monitor":     if let v = args.first, let n = Int(v) { opts.monitorIndex = n; args.removeFirst() }
            case "--size":        if let v = args.first, let n = Double(v) { opts.windowSize = CGFloat(n); args.removeFirst() }
            case "--click-through": opts.clickThrough = true
            case "--help", "-h":
                print("""
                FamiliarAvatar — native desk-pet overlay (subscribes to avatar.sock)
                  --socket <path>     Unix socket to subscribe to (default $FAMILIAR_HOME/avatar.sock)
                  --monitor <n>       0-based display index (default 1 = monitor-2)
                  --size <points>     square window edge (default 360)
                  --click-through     start in click-through (pet) mode
                Hotkeys (global, need Accessibility permission):
                  ⌃⌥⌘P  toggle click-through    ⌃⌥⌘Q  quit
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
    private var renderer: MetalSpineRenderer!
    private var subscriber: SocketSubscriber!
    private var model: SpineModel!
    private var monitors: [Any] = []
    private var clickThrough: Bool

    init(options: Options) {
        self.options = options
        self.clickThrough = options.clickThrough
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let skel = Bundle.module.url(forResource: "spineboy-pro", withExtension: "skel", subdirectory: "Resources"),
              let atlas = Bundle.module.url(forResource: "spineboy-pma", withExtension: "atlas", subdirectory: "Resources") else {
            fail("bundled spineboy assets not found")
            return
        }
        guard let model = SpineModel(skelPath: skel.path, atlasPath: atlas.path) else {
            fail("failed to load spine skeleton/atlas")
            return
        }
        self.model = model

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
        guard let renderer = MetalSpineRenderer(view: view, model: model) else {
            fail("failed to init Metal renderer")
            return
        }
        self.renderer = renderer
        view.delegate = renderer
        window.contentView = view
        window.ignoresMouseEvents = clickThrough
        window.orderFrontRegardless()

        subscriber = SocketSubscriber(path: options.socketPath) { [weak self] command in
            self?.model.apply(command)
        }
        subscriber.start()

        installHotkeys()

        let screenNote = actualIndex == options.monitorIndex ? "display \(actualIndex)" : "display \(actualIndex) (requested \(options.monitorIndex), not present)"
        FileHandle.standardError.write(Data("""
        [avatar] running on \(screenNote) of \(screens.count) — \(clickThrough ? "click-through" : "interactive (drag to move)")
        [avatar] subscribing to \(options.socketPath)
        \n
        """.utf8))
    }

    private func installHotkeys() {
        let handler: (NSEvent) -> Void = { [weak self] event in
            guard let self else { return }
            let flags = event.modifierFlags.intersection([.control, .option, .command])
            guard flags == [.control, .option, .command] else { return }
            switch event.charactersIgnoringModifiers {
            case "p": self.toggleClickThrough()
            case "q": NSApp.terminate(nil)
            default: break
            }
        }
        if let g = NSEvent.addGlobalMonitorForEvents(matching: .keyDown, handler: handler) { monitors.append(g) }
        if let l = NSEvent.addLocalMonitorForEvents(matching: .keyDown, handler: { handler($0); return $0 }) { monitors.append(l) }
    }

    private func toggleClickThrough() {
        clickThrough.toggle()
        window.ignoresMouseEvents = clickThrough
        FileHandle.standardError.write(Data("[avatar] click-through \(clickThrough ? "ON" : "OFF")\n".utf8))
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
