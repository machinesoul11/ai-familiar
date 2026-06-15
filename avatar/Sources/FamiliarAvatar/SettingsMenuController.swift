import AppKit
import Foundation

/// The Phase 6 control surface: a native menubar (`NSStatusItem`) settings pane
/// living in the running avatar process. It is a thin GUI FRONT-END over the
/// `familiar-config` CLI — every write shells out to that binary so ALL
/// validation stays in the Node/Vitest loop, never re-implemented in Swift (the
/// locked 6.3 decision). The menu only READS `settings.json` directly (to show
/// the current state) and WRITES exclusively through `familiar-config`.
///
/// Apply timing (the cross-language store boundary):
///   - daemon-consumed fields (voice / recapLang / proactive / stt / stop) take
///     effect on the daemon's NEXT event — the daemon re-reads the store per
///     event (6.2/6.4), so no restart is needed.
///   - avatar presentation fields (scale / monitor / character) are read ONCE at
///     launch (`AvatarSettings`), so they are labeled "(restart to apply)" and a
///     one-click "Relaunch avatar" re-execs the process. True live-apply-to-self
///     is deferred.
///
/// When no `familiar-config` command is configured (`--config-cmd` / the
/// `FAMILIAR_CONFIG` env both unset) the menu still shows the stored state but
/// all write items are disabled — the pane degrades to read-only.
final class SettingsMenuController: NSObject, NSMenuDelegate {
    private let home: String
    /// The `familiar-config` invocation, pre-split into argv tokens (e.g.
    /// ["node", "/abs/dist/bin/familiar-config.js"]). Nil ⇒ read-only menu.
    private let configCmd: [String]?
    /// Re-exec the avatar with its original launch args (applies the presentation
    /// fields that are read only at startup).
    private let relaunch: () -> Void

    private var statusItem: NSStatusItem?

    /// Built-in defaults mirroring `DEFAULT_SETTINGS` in `src/settings.ts` — the
    /// value shown (and check-marked) for a field absent from the store. Same
    /// constants the avatar's own launch path already hardcodes (1.0 / 2 / "").
    private enum Defaults {
        static let recapLang = "en"
        static let voice = "say"
        static let proactive = false
        static let stt = true
        static let stop = true
        static let scale = 1.0
        static let monitor = 2
        static let character = ""
    }

    private static let recapLangNames: [(code: String, label: String)] = [
        ("en", "English"),
        ("es", "Spanish (Español)"),
        ("fr", "French (Français)"),
        ("de", "German (Deutsch)"),
        ("ja", "Japanese (日本語)"),
    ]

    private static let scalePresets: [Double] = [0.75, 1.0, 1.25, 1.5, 2.0]

    init(home: String, configCmd: [String]?, relaunch: @escaping () -> Void) {
        self.home = home
        self.configCmd = configCmd
        self.relaunch = relaunch
    }

    /// Create the menubar item. Call once, after the app finishes launching.
    func install() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            // Icon + a short label so it's unmistakable in a crowded menu bar.
            if let image = NSImage(systemSymbolName: "sparkles", accessibilityDescription: "Familiar") {
                image.isTemplate = true
                button.image = image
                button.imagePosition = .imageLeading
            }
            button.title = "Familiar"
        }
        let menu = NSMenu()
        menu.autoenablesItems = false // we control isEnabled ourselves (read-only degrade)
        menu.delegate = self
        item.menu = menu
        statusItem = item
        FileHandle.standardError.write(Data("[avatar] settings menu installed — press ⌃⌥⌘S to open it at the cursor (or click “✦ Familiar” in the menu bar if it fits)\n".utf8))
    }

    /// Pop the settings menu up at the mouse cursor — a menu-bar-independent way
    /// to open it (the status item can be hidden behind the notch on a crowded
    /// menu bar). Driven by a global hotkey. `in: nil` ⇒ screen coordinates.
    func popUpAtMouse() {
        let menu = NSMenu()
        menu.autoenablesItems = false
        rebuild(menu)
        menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
    }

    // MARK: - Menu construction (rebuilt on each open so state stays fresh)

    func menuNeedsUpdate(_ menu: NSMenu) {
        rebuild(menu)
    }

    private func rebuild(_ menu: NSMenu) {
        menu.removeAllItems()
        let stored = StoredConfig.load(home: home)
        let hasSecret = stored.elevenLabsKeyPresent
        let writable = configCmd != nil

        let header = NSMenuItem(title: "Familiar", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        menu.addItem(.separator())

        // Voice — daemon field. The store default is "say", but 6.2's B2 rule says
        // an unset voice with a secret present resolves to elevenlabs; mirror just
        // that one rule so the check mark matches what the daemon will actually do.
        let voice = stored.voice ?? (hasSecret ? "elevenlabs" : Defaults.voice)
        let voiceMenu = NSMenu()
        voiceMenu.autoenablesItems = false
        addChoice(to: voiceMenu, title: "Spoken (say)", checked: voice == "say",
                  enabled: writable, action: .set(key: "voice", value: "say"))
        addChoice(to: voiceMenu, title: "ElevenLabs", checked: voice == "elevenlabs",
                  enabled: writable, action: .set(key: "voice", value: "elevenlabs"))
        voiceMenu.addItem(.separator())
        addChoice(to: voiceMenu, title: "Set ElevenLabs key…", checked: false,
                  enabled: writable, action: .setSecret)
        let secretNote = NSMenuItem(title: hasSecret ? "ElevenLabs key: set" : "ElevenLabs key: not set",
                                    action: nil, keyEquivalent: "")
        secretNote.isEnabled = false
        voiceMenu.addItem(secretNote)
        addSubmenu(to: menu, title: "Voice", submenu: voiceMenu)

        // Recap language — daemon field.
        let lang = stored.recapLang ?? Defaults.recapLang
        let langMenu = NSMenu()
        langMenu.autoenablesItems = false
        for entry in Self.recapLangNames {
            addChoice(to: langMenu, title: "\(entry.label) (\(entry.code))",
                      checked: lang == entry.code, enabled: writable,
                      action: .set(key: "recapLang", value: entry.code))
        }
        addSubmenu(to: menu, title: "Recap language", submenu: langMenu)

        // Toggles — daemon fields. Clicking flips the stored boolean.
        addToggle(to: menu, title: "Proactive narration",
                  on: stored.proactive ?? Defaults.proactive, enabled: writable, key: "proactive")
        addToggle(to: menu, title: "Voice talk-back (STT)",
                  on: stored.stt ?? Defaults.stt, enabled: writable, key: "stt")
        addToggle(to: menu, title: "Tap / voice stop",
                  on: stored.stop ?? Defaults.stop, enabled: writable, key: "stop")

        menu.addItem(.separator())
        let presNote = NSMenuItem(title: "Appearance (restart to apply)", action: nil, keyEquivalent: "")
        presNote.isEnabled = false
        menu.addItem(presNote)

        // Avatar scale — presentation field. Show preset multipliers; include the
        // current value if it isn't one of the presets.
        let scale = stored.scale ?? Defaults.scale
        var presets = Self.scalePresets
        if !presets.contains(where: { abs($0 - scale) < 0.0001 }) { presets.append(scale); presets.sort() }
        let scaleMenu = NSMenu()
        scaleMenu.autoenablesItems = false
        for preset in presets {
            addChoice(to: scaleMenu, title: formatScale(preset),
                      checked: abs(preset - scale) < 0.0001, enabled: writable,
                      action: .set(key: "avatar.scale", value: formatNumber(preset)))
        }
        addSubmenu(to: menu, title: "Avatar scale", submenu: scaleMenu)

        // Avatar monitor — presentation field. 1-based, one entry per attached
        // display (settings.json stores 1-based; the launch path converts).
        let monitor = stored.monitor ?? Defaults.monitor
        let monitorMenu = NSMenu()
        monitorMenu.autoenablesItems = false
        let screenCount = max(1, NSScreen.screens.count)
        // Always offer at least up to the stored value, even if that display is
        // currently detached, so the choice round-trips.
        let maxMonitor = max(screenCount, monitor)
        for n in 1...maxMonitor {
            let present = n <= screenCount
            addChoice(to: monitorMenu, title: present ? "Display \(n)" : "Display \(n) (not connected)",
                      checked: n == monitor, enabled: writable,
                      action: .set(key: "avatar.monitor", value: String(n)))
        }
        addSubmenu(to: menu, title: "Avatar monitor", submenu: monitorMenu)

        // Character — presentation field. Discover packs under
        // $FAMILIAR_HOME/characters/ and ./characters/; "(default)" unsets it.
        let character = stored.character ?? Defaults.character
        let charMenu = NSMenu()
        charMenu.autoenablesItems = false
        addChoice(to: charMenu, title: "(default)", checked: character.isEmpty,
                  enabled: writable, action: .unset(key: "avatar.character"))
        var names = discoverCharacters()
        if !character.isEmpty && !names.contains(character) { names.append(character); names.sort() }
        for name in names {
            addChoice(to: charMenu, title: name, checked: name == character,
                      enabled: writable, action: .set(key: "avatar.character", value: name))
        }
        addSubmenu(to: menu, title: "Character", submenu: charMenu)

        menu.addItem(.separator())

        if !writable {
            let note = NSMenuItem(title: "Read-only — launch with --config-cmd to edit",
                                  action: nil, keyEquivalent: "")
            note.isEnabled = false
            menu.addItem(note)
        }

        addAction(to: menu, title: "Relaunch avatar", enabled: true, action: .relaunch)
        addAction(to: menu, title: "Quit Familiar", enabled: true, action: .quit)
    }

    // MARK: - Item builders

    private func addSubmenu(to menu: NSMenu, title: String, submenu: NSMenu) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = submenu
        menu.addItem(item)
    }

    private func addChoice(to menu: NSMenu, title: String, checked: Bool, enabled: Bool, action: MenuAction) {
        let item = NSMenuItem(title: title, action: #selector(handle(_:)), keyEquivalent: "")
        item.target = self
        item.representedObject = ActionBox(action)
        item.state = checked ? .on : .off
        item.isEnabled = enabled
        menu.addItem(item)
    }

    private func addToggle(to menu: NSMenu, title: String, on: Bool, enabled: Bool, key: String) {
        addChoice(to: menu, title: title, checked: on, enabled: enabled,
                  action: .set(key: key, value: on ? "false" : "true"))
    }

    private func addAction(to menu: NSMenu, title: String, enabled: Bool, action: MenuAction) {
        let item = NSMenuItem(title: title, action: #selector(handle(_:)), keyEquivalent: "")
        item.target = self
        item.representedObject = ActionBox(action)
        item.isEnabled = enabled
        menu.addItem(item)
    }

    // MARK: - Actions

    @objc private func handle(_ sender: NSMenuItem) {
        guard let action = (sender.representedObject as? ActionBox)?.action else { return }
        switch action {
        case let .set(key, value):
            if runConfig(["set", key, value]) && key.hasPrefix("avatar.") {
                offerRelaunch(for: key)
            }
        case let .unset(key):
            if runConfig(["unset", key]) && key.hasPrefix("avatar.") {
                offerRelaunch(for: key)
            }
        case .setSecret:
            promptForSecret()
        case .relaunch:
            relaunch()
        case .quit:
            NSApp.terminate(nil)
        }
    }

    /// Shell out to `familiar-config <args>`. Returns true on success (exit 0).
    /// Surfaces any failure (non-zero exit) in an alert with the CLI's own
    /// stderr. No-ops with a guard alert if no command is configured (the write
    /// items should already be disabled).
    @discardableResult
    private func runConfig(_ args: [String]) -> Bool {
        guard let cmd = configCmd, let first = cmd.first else {
            warn("No familiar-config command configured.",
                 "Launch the avatar with --config-cmd \"node /path/to/dist/bin/familiar-config.js\" (or set FAMILIAR_CONFIG) to edit settings.")
            return false
        }

        let process = Process()
        var argv: [String]
        if first.hasPrefix("/") {
            process.executableURL = URL(fileURLWithPath: first)
            argv = Array(cmd.dropFirst()) + args
        } else {
            // Resolve a bare command (e.g. "node") via PATH.
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            argv = cmd + args
        }
        process.arguments = argv

        var env = ProcessInfo.processInfo.environment
        env["FAMILIAR_HOME"] = home // keep the CLI's store root aligned with ours
        process.environment = env

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: data, encoding: .utf8) ?? ""
            if process.terminationStatus != 0 {
                warn("familiar-config failed (exit \(process.terminationStatus)).",
                     output.isEmpty ? "No output." : output)
                return false
            }
            return true
        } catch {
            warn("Could not run familiar-config.", "\(error.localizedDescription)\nCommand: \(([first] + argv).joined(separator: " "))")
            return false
        }
    }

    /// Appearance fields (scale / monitor / character) are read once at launch, so
    /// a write doesn't change the running avatar until it re-execs. Make that
    /// one-click: confirm the save and offer to relaunch now.
    private func offerRelaunch(for key: String) {
        let field = key.hasPrefix("avatar.") ? String(key.dropFirst("avatar.".count)) : key
        let alert = NSAlert()
        alert.messageText = "Saved avatar \(field)."
        alert.informativeText = "Appearance changes apply after the avatar relaunches."
        alert.addButton(withTitle: "Relaunch now")
        alert.addButton(withTitle: "Later")
        if alert.runModal() == .alertFirstButtonReturn {
            relaunch()
        }
    }

    /// Prompt for the ElevenLabs API key in a secure field and write it via
    /// `familiar-config set-secret apiKey`. The key is never logged or echoed.
    private func promptForSecret() {
        let alert = NSAlert()
        alert.messageText = "Set ElevenLabs API key"
        alert.informativeText = "Stored in $FAMILIAR_HOME/.env (mode 0600). Restart the daemon to apply."
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.placeholderString = "ELEVENLABS_API_KEY"
        alert.accessoryView = field
        alert.window.initialFirstResponder = field

        if alert.runModal() == .alertFirstButtonReturn {
            let value = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if value.isEmpty {
                warn("Empty key.", "No key was entered; nothing was written.")
                return
            }
            runConfig(["set-secret", "apiKey", value])
        }
    }

    private func warn(_ message: String, _ info: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = message
        alert.informativeText = info
        alert.runModal()
    }

    // MARK: - Discovery / formatting

    /// Character pack NAMES (directory names) under $FAMILIAR_HOME/characters/ and
    /// ./characters/ — the same two roots the launch path resolves a name against.
    private func discoverCharacters() -> [String] {
        let fm = FileManager.default
        let roots = [
            (home as NSString).appendingPathComponent("characters"),
            (fm.currentDirectoryPath as NSString).appendingPathComponent("characters"),
        ]
        var names = Set<String>()
        for root in roots {
            guard let entries = try? fm.contentsOfDirectory(atPath: root) else { continue }
            for entry in entries {
                var isDir: ObjCBool = false
                let path = (root as NSString).appendingPathComponent(entry)
                if fm.fileExists(atPath: path, isDirectory: &isDir), isDir.boolValue, !entry.hasPrefix(".") {
                    names.insert(entry)
                }
            }
        }
        return names.sorted()
    }

    private func formatScale(_ value: Double) -> String {
        "\(formatNumber(value))×"
    }

    /// Compact decimal: drop a trailing ".0" so 1.0 → "1", 1.25 → "1.25".
    private func formatNumber(_ value: Double) -> String {
        if value == value.rounded() { return String(Int(value)) }
        return String(value)
    }
}

/// Box a Swift enum for storage in `NSMenuItem.representedObject` (Any?).
private final class ActionBox {
    let action: MenuAction
    init(_ action: MenuAction) { self.action = action }
}

private enum MenuAction {
    case set(key: String, value: String)
    case unset(key: String)
    case setSecret
    case relaunch
    case quit
}

/// A total, never-throw read of the FULL `$FAMILIAR_HOME/settings.json` store for
/// the menu's current-state display (a superset of `AvatarSettings`, which reads
/// only the avatar sub-object at launch). Each field is the STORED value or nil
/// (absent / wrong-typed) — the caller applies the built-in default. Mirrors
/// `parseSettings`'s per-field totality; env-var overrides and the daemon's tts
/// reconciliation are intentionally NOT reflected (this shows the persistent
/// store the pane edits, not boot/dev escape hatches).
private struct StoredConfig {
    var recapLang: String?
    var voice: String?
    var proactive: Bool?
    var stt: Bool?
    var stop: Bool?
    var scale: Double?
    var monitor: Int?
    var character: String?
    var elevenLabsKeyPresent: Bool = false

    static func load(home: String) -> StoredConfig {
        var c = StoredConfig()
        c.elevenLabsKeyPresent = secretPresent(home: home)

        let path = (home as NSString).appendingPathComponent("settings.json")
        guard let data = FileManager.default.contents(atPath: path),
              let root = try? JSONSerialization.jsonObject(with: data),
              let obj = root as? [String: Any] else {
            return c
        }

        if let s = obj["recapLang"] as? String, !s.isEmpty { c.recapLang = s }
        if let s = obj["voice"] as? String, !s.isEmpty { c.voice = s }
        if let b = obj["proactive"] as? Bool { c.proactive = b }
        if let b = obj["stt"] as? Bool { c.stt = b }
        if let b = obj["stop"] as? Bool { c.stop = b }
        if let avatar = obj["avatar"] as? [String: Any] {
            if let n = avatar["scale"] as? NSNumber { c.scale = n.doubleValue }
            if let n = avatar["monitor"] as? NSNumber { c.monitor = n.intValue }
            if let s = avatar["character"] as? String, !s.isEmpty { c.character = s }
        }
        return c
    }

    /// True iff `$FAMILIAR_HOME/.env` has a non-empty `ELEVENLABS_API_KEY=` line.
    private static func secretPresent(home: String) -> Bool {
        let path = (home as NSString).appendingPathComponent(".env")
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return false }
        for line in text.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("ELEVENLABS_API_KEY=") else { continue }
            let value = trimmed.dropFirst("ELEVENLABS_API_KEY=".count).trimmingCharacters(in: .whitespaces)
            return !value.isEmpty
        }
        return false
    }
}
