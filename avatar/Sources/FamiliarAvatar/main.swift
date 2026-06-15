import AppKit
import MetalKit
import Foundation

// Parsed launch options. Everything has a sensible default so the app runs with
// no arguments; the harness/daemon flags are for by-eye driving.
struct Options {
    var socketPath: String
    var intentSocketPath: String
    var monitorIndex: Int
    var startLocked: Bool
    var windowSize: CGFloat
    var characterDir: String?
    var wakeWord: String?
    /// $FAMILIAR_HOME — the removable state root (settings.json / .env live here).
    var home: String
    /// `familiar-config` invocation for the menubar settings pane, pre-split into
    /// argv tokens. Nil ⇒ the pane is read-only. (`--config-cmd` > FAMILIAR_CONFIG.)
    var configCmd: [String]?

    /// Base window edge (points) for `scale: 1.0`. The user-facing `avatar.scale`
    /// is a multiplier on top of this; `--size` overrides with an absolute edge.
    static let baseWindowSize: CGFloat = 360

    static func parse() -> Options {
        let env = ProcessInfo.processInfo.environment
        let home = env["FAMILIAR_HOME"]
            ?? (NSHomeDirectory() as NSString).appendingPathComponent(".familiar")

        // Presentation prefs resolve with precedence: explicit env var >
        // settings.json > built-in default (the locked cross-language contract),
        // and the CLI flags parsed below override on top of all three. Env vars
        // mirror Node's SETTINGS_ENV_KEYS and share the file's units (monitor
        // 1-based, scale a multiplier).
        let file = AvatarSettings.load(home: home)
        let scale = doubleEnv(env["FAMILIAR_AVATAR_SCALE"]) ?? file.scale ?? 1.0
        let monitor1Based = intEnv(env["FAMILIAR_AVATAR_MONITOR"]) ?? file.monitor ?? 2
        let characterPref = nonEmptyEnv(env["FAMILIAR_AVATAR_CHARACTER"]) ?? file.character

        var opts = Options(
            socketPath: (home as NSString).appendingPathComponent("avatar.sock"),
            intentSocketPath: (home as NSString).appendingPathComponent("intent.sock"),
            monitorIndex: max(0, monitor1Based - 1), // 1-based settings → 0-based NSScreen index
            startLocked: false,
            windowSize: baseWindowSize * CGFloat(scale),
            characterDir: characterPref.flatMap { resolveCharacterDir($0, home: home) },
            wakeWord: nil,
            home: home,
            configCmd: tokenizeConfigCmd(env["FAMILIAR_CONFIG"])
        )
        var args = Array(CommandLine.arguments.dropFirst())
        while let arg = args.first {
            args.removeFirst()
            switch arg {
            case "--socket":        if let v = args.first { opts.socketPath = v; args.removeFirst() }
            case "--intent-socket": if let v = args.first { opts.intentSocketPath = v; args.removeFirst() }
            case "--monitor":     if let v = args.first, let n = Int(v) { opts.monitorIndex = n; args.removeFirst() }
            case "--size":        if let v = args.first, let n = Double(v) { opts.windowSize = CGFloat(n); args.removeFirst() }
            case "--character":   if let v = args.first { opts.characterDir = v; args.removeFirst() }
            case "--wake-word":   if let v = args.first { opts.wakeWord = v; args.removeFirst() }
            case "--config-cmd":  if let v = args.first { opts.configCmd = tokenizeConfigCmd(v); args.removeFirst() }
            case "--locked":        opts.startLocked = true
            case "--click-through": break   // deprecated: pass-through is now the default
            case "--help", "-h":
                print("""
                FamiliarAvatar — native desk-pet overlay (subscribes to avatar.sock)
                  --socket <path>     Unix socket to subscribe to (default $FAMILIAR_HOME/avatar.sock)
                  --intent-socket <p> upstream intent socket to write to (default $FAMILIAR_HOME/intent.sock)
                  --monitor <n>       0-based display index (default from settings avatar.monitor,
                                      a 1-based number; built-in 2 = monitor-2)
                  --size <points>     absolute square window edge — OVERRIDES avatar.scale
                                      (default = 360 × scale; built-in scale 1.0 ⇒ 360)
                  --character <dir>   character pack folder (a *.config.json + assets); else
                                      settings avatar.character (a NAME under
                                      $FAMILIAR_HOME/characters/ or ./characters/, or a path),
                                      else $FAMILIAR_HOME/character/, else bundled spineboy
                Presentation prefs (scale / monitor / character) also read from
                $FAMILIAR_HOME/settings.json; precedence: CLI flag > FAMILIAR_AVATAR_* env
                > settings.json > built-in default (run `familiar-config` to edit the store).
                  --wake-word <word>  5.4 STT (default OFF): listen for this spoken word, then
                                      send the command after it as a voice intent. REQUIRES the
                                      signed FamiliarAvatar.app (mic/speech TCC) — ignored when
                                      run as a bare CLI. e.g. --wake-word haru
                  --config-cmd <cmd>  command the menubar settings pane shells out to for writes
                                      (else FAMILIAR_CONFIG env). Prefer absolute paths so PATH
                                      doesn't matter, e.g.
                                      --config-cmd "node /abs/dist/bin/familiar-config.js".
                                      Unset ⇒ the pane is read-only.
                  --locked            start engaged+locked (interactive, no auto-release)
                  --click-through     deprecated (pass-through is the default now)
                Pass-through by default: clicks reach apps behind her. DOUBLE-CLICK her
                body to engage; then DRAG to move, quick-TAP her to STOP her if she's
                talking (else replay the recap), or LONG-PRESS (~0.5 s) her for the
                "while you were away" rollup. She auto-releases ~4 s after you stop.
                With --wake-word you can also just SAY "<wake> recap", "<wake> what did
                I miss", or "<wake> stop" to silence her.
                Hotkeys (global keyboard monitor needs Accessibility permission):
                  ⌃⌥⌘P  lock/unlock engaged    ⌃⌥⌘Q  quit
                  ⌃⌥⌘S  open the settings menu at the cursor (also in the
                        menu bar as “✦ Familiar”, if it fits)
                """)
                exit(0)
            default:
                break
            }
        }
        return opts
    }

    /// A valid env override (else nil → fall through to file/default), mirroring
    /// Node's `Number()`-based env parsing. Empty/non-numeric ⇒ nil.
    private static func doubleEnv(_ v: String?) -> Double? {
        guard let v, !v.isEmpty else { return nil }
        return Double(v)
    }

    private static func intEnv(_ v: String?) -> Int? {
        guard let v, !v.isEmpty else { return nil }
        return Int(v)
    }

    private static func nonEmptyEnv(_ v: String?) -> String? {
        guard let v else { return nil }
        let t = v.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? nil : t
    }

    /// Split a `familiar-config` command string into argv tokens on whitespace
    /// (e.g. "node /abs/familiar-config.js" → ["node", "/abs/familiar-config.js"]).
    /// Empty/absent ⇒ nil (the pane stays read-only). Paths with spaces are not
    /// supported — use a space-free path (the by-eye dev constraint).
    private static func tokenizeConfigCmd(_ v: String?) -> [String]? {
        guard let v else { return nil }
        let tokens = v.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        return tokens.isEmpty ? nil : tokens
    }

    /// Resolve the `avatar.character` preference to a pack directory. A value
    /// containing "/" is a literal path (consistent with --character). Otherwise
    /// it's a NAME tried under `$FAMILIAR_HOME/characters/<name>/` then
    /// `./characters/<name>/` (dev convenience). Not found ⇒ nil → the existing
    /// ResolvedCharacter fallbacks ($FAMILIAR_HOME/character/ → bundled spineboy).
    private static func resolveCharacterDir(_ value: String, home: String) -> String? {
        if value.contains("/") { return value }
        let fm = FileManager.default
        let candidates = [
            (home as NSString).appendingPathComponent("characters/\(value)"),
            (fm.currentDirectoryPath as NSString).appendingPathComponent("characters/\(value)"),
        ]
        for dir in candidates {
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: dir, isDirectory: &isDir), isDir.boolValue { return dir }
        }
        FileHandle.standardError.write(Data("[avatar] settings character '\(value)' not found under $FAMILIAR_HOME/characters/ or ./characters/; using fallback\n".utf8))
        return nil
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
    private var thoughtBubble: ThoughtBubbleController!
    private var intentPublisher: IntentPublisher!
    private var speechListener: SpeechListener?
    private var settingsMenu: SettingsMenuController!
    private var lastPullTapAt = Date.distantPast

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

        // Touch / input channel (4.4 + 5.2): a gesture on her body while engaged
        // emits an upstream intent on intent.sock. The overlay stays dumb — it
        // sends a semantic intent and the daemon decides what it does. Two gestures,
        // two intents: a quick tap → "pull-recap" (replays the latest recap), a
        // long-press → "recall" (the "while you were away" activity rollup).
        intentPublisher = IntentPublisher(path: options.intentSocketPath)
        // Debounce taps: each tap replays the latest recap, so rapid taps used to
        // queue a pile of them and play back-to-back (the "looping recaps"). Ignore
        // taps within 1.5 s of the last.
        engagement.onTap = { [weak self] in
            guard let self else { return }
            let now = Date()
            guard now.timeIntervalSince(self.lastPullTapAt) > 1.5 else { return }
            self.lastPullTapAt = now
            self.intentPublisher.sendTap()
        }
        engagement.onLongPress = { [weak self] in self?.intentPublisher.sendRecall() }

        // Voice talk-back (5.4 STT, default OFF): a spoken "<wake> recap" / "<wake>
        // what did I miss" emits the SAME upstream intents as the gestures, through
        // one more semantic intent ("utterance") the daemon classifies. The mic +
        // on-device recognizer only work from a signed .app bundle (TCC reads the
        // usage strings only there; a bare CLI hard-crashes), so we GATE on those
        // strings being present and skip — never crash — otherwise.
        if let wakeWord = options.wakeWord {
            let info = Bundle.main.infoDictionary
            let hasUsageStrings = (info?["NSSpeechRecognitionUsageDescription"] != nil)
                && (info?["NSMicrophoneUsageDescription"] != nil)
            if hasUsageStrings {
                let listener = SpeechListener(wakeWord: wakeWord) { [weak self] command in
                    self?.intentPublisher.sendUtterance(command)
                }
                listener.start()
                speechListener = listener
            } else {
                FileHandle.standardError.write(Data("[avatar] voice: --wake-word \"\(wakeWord)\" ignored — STT needs the signed FamiliarAvatar.app (mic/speech usage strings); run from the bundle.\n".utf8))
            }
        }

        // Inner-thoughts display (4.3): a renderer-agnostic bubble floating above
        // her head that SHOWS the silent `thought` text but never speaks it.
        thoughtBubble = ThoughtBubbleController(parent: window)

        subscriber = SocketSubscriber(path: options.socketPath) { [weak self] command in
            self?.model.apply(command)
            self?.thoughtBubble.apply(command)
        }
        subscriber.start()

        // Phase 6 control surface: a menubar settings pane that shells out to
        // familiar-config for writes (validation stays in the Node/Vitest loop).
        settingsMenu = SettingsMenuController(
            home: options.home,
            configCmd: options.configCmd,
            relaunch: { [weak self] in self?.relaunch() }
        )
        settingsMenu.install()

        installHotkeys()

        let screenNote = actualIndex == options.monitorIndex ? "display \(actualIndex)" : "display \(actualIndex) (requested \(options.monitorIndex), not present)"
        FileHandle.standardError.write(Data("""
        [avatar] window \(Int(options.windowSize))pt on \(screenNote) of \(screens.count) — pass-through (double-click to engage\(options.startLocked ? "; started locked" : ""))
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
            case "s": self.settingsMenu.popUpAtMouse()
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

    /// Re-exec the avatar with its original launch arguments, then quit — the way
    /// the menubar pane applies the presentation fields (scale / monitor /
    /// character) that are read only at startup. Launched from a signed .app, we
    /// re-open the bundle (preserving the bundle context, e.g. mic/speech TCC);
    /// as a bare CLI we re-exec the binary directly. Two instances coexist for a
    /// blink — fine, since the avatar only CONNECTS to sockets (the daemon binds).
    private func relaunch() {
        let args = Array(CommandLine.arguments.dropFirst())
        let bundlePath = Bundle.main.bundlePath
        let process = Process()
        if bundlePath.hasSuffix(".app") {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            process.arguments = [bundlePath, "--args"] + args
        } else {
            process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
            process.arguments = args
        }
        do {
            try process.run()
        } catch {
            FileHandle.standardError.write(Data("[avatar] relaunch failed: \(error.localizedDescription)\n".utf8))
            return
        }
        NSApp.terminate(nil)
    }
}

let options = Options.parse()
let app = NSApplication.shared
app.setActivationPolicy(.accessory) // no Dock icon — it's a desk pet
let delegate = AppDelegate(options: options)
app.delegate = delegate
app.run()
