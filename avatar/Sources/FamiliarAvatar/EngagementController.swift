import AppKit
import MetalKit

/// Owns the overlay's click-through ("pet") behavior.
///
/// The window is **pass-through by DEFAULT**: every click reaches the app behind
/// Haru, so her square window never blocks the browser/UI underneath her — even
/// directly under her body. A deliberate **double-click on her body ENGAGES**
/// her: the window becomes interactive so she can be dragged to reposition.
/// Engagement auto-expires ~4 s after the last interaction, or the moment you
/// click away from her. A manual **lock** (⌃⌥⌘P) holds her engaged with no
/// timeout, for long repositioning sessions.
///
/// The engage gate is a passive **global** left-mouse-down monitor. Unlike
/// keyboard monitoring, global *mouse* monitoring needs **no Accessibility
/// permission**, so the install stays zero-friction (per the removable-state
/// invariant). The tradeoff: a global monitor cannot CONSUME the event, so the
/// engaging double-click also reaches the app behind her — minor, since you are
/// deliberately double-clicking the pet. Consuming would need a CGEventTap + an
/// Accessibility prompt, rejected to keep the install frictionless.
///
/// Hit precision v1 is a tight **ellipse** inscribed in an inset box around her
/// body (not the full square window, not a per-pixel alpha silhouette — that is
/// a tracked later refinement). The insets are tunable per character.
final class EngagementController {
    private unowned let window: OverlayWindow
    private let view: DraggableMetalView
    private let timeout: TimeInterval
    private let hitInsetX: CGFloat   // fraction of width inset on EACH side
    private let hitInsetY: CGFloat   // fraction of height inset on EACH side

    private var engaged = false
    private var locked = false
    private var disengageTimer: Timer?
    private var globalMonitor: Any?
    private let highlight = CAShapeLayer()

    /// Fired when she is engaged and you click her body WITHOUT dragging (a tap).
    /// The 4.4 touch channel injects the upstream "pull-recap" intent here. The
    /// controller stays renderer-agnostic — it only knows "tapped", not what it means.
    var onTap: (() -> Void)?

    init(window: OverlayWindow,
         view: DraggableMetalView,
         timeout: TimeInterval = 4.0,
         hitInsetX: CGFloat = 0.20,
         hitInsetY: CGFloat = 0.06) {
        self.window = window
        self.view = view
        self.timeout = timeout
        self.hitInsetX = min(max(hitInsetX, 0), 0.49)
        self.hitInsetY = min(max(hitInsetY, 0), 0.49)
    }

    /// Install the global monitor, wire the view back to us, and start in the
    /// default pass-through state.
    func start() {
        view.engagement = self
        setupHighlight()
        applyPassThrough()
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            self?.globalMouseDown(event)
        }
    }

    // MARK: - State transitions

    /// Engage from pass-through (double-click on her body). No-op if locked.
    private func engage() {
        guard !engaged else { resetTimer(); return }
        engaged = true
        window.ignoresMouseEvents = false
        showHighlight(true)
        resetTimer()
        log("engaged (drag to move — auto-releases)")
    }

    /// Return to pass-through. Also clears a manual lock.
    private func disengage() {
        engaged = false
        locked = false
        disengageTimer?.invalidate()
        disengageTimer = nil
        applyPassThrough()
        log("pass-through (clicks pass through to apps behind)")
    }

    private func applyPassThrough() {
        window.ignoresMouseEvents = true
        showHighlight(false)
    }

    /// ⌃⌥⌘P: toggle a manual lock that holds her engaged with no timeout — for
    /// long repositioning. Toggling off returns to pass-through.
    func toggleLock() {
        if locked {
            disengage()
        } else {
            locked = true
            engaged = true
            disengageTimer?.invalidate()
            disengageTimer = nil
            window.ignoresMouseEvents = false
            showHighlight(true)
            log("locked (engaged, no timeout — ⌃⌥⌘P to release)")
        }
    }

    // MARK: - Timeout

    private func resetTimer() {
        disengageTimer?.invalidate()
        guard !locked else { return }
        disengageTimer = Timer.scheduledTimer(withTimeInterval: timeout, repeats: false) { [weak self] _ in
            guard let self, self.engaged, !self.locked else { return }
            self.disengage()
        }
    }

    // MARK: - Global monitor (pass-through clicks)

    private func globalMouseDown(_ event: NSEvent) {
        if locked { return }
        if engaged {
            // While engaged, clicks ON the (now interactive) window are delivered
            // locally — so a click that reaches the GLOBAL monitor landed off the
            // window entirely: a click-away → release her.
            disengage()
        } else if event.clickCount == 2 && hitContainsScreen(NSEvent.mouseLocation) {
            engage()
        }
    }

    // MARK: - Local view callbacks (only fire while interactive)

    /// The view got a local mouse-down (reachable only while engaged/locked).
    /// Inside her body → start a drag and refresh the timeout (returns true).
    /// On a transparent corner → treat as click-away and release (returns false).
    func viewMouseDown(_ event: NSEvent) -> Bool {
        let screenPoint = window.convertPoint(toScreen: event.locationInWindow)
        if !locked && !hitContainsScreen(screenPoint) {
            disengage()
            return false
        }
        resetTimer()
        return true
    }

    /// Called after a body press completes (performDrag runs its own loop until
    /// mouse-up). If the window did not move, the press was a TAP — fire onTap (the
    /// 4.4 pull-recap intent). Either way, refresh the auto-release timeout from the
    /// end of the interaction.
    func viewInteractionEnded(moved: Bool) {
        if !moved { onTap?() }
        resetTimer()
    }

    // MARK: - Hit region (ellipse inscribed in the inset box, screen coords)

    private func hitContainsScreen(_ point: CGPoint) -> Bool {
        let frame = window.frame
        let rx = frame.width * (0.5 - hitInsetX)
        let ry = frame.height * (0.5 - hitInsetY)
        guard rx > 0, ry > 0 else { return false }
        let dx = (point.x - frame.midX) / rx
        let dy = (point.y - frame.midY) / ry
        return dx * dx + dy * dy <= 1.0
    }

    // MARK: - Visual cue (soft glow ellipse over her body)

    private func setupHighlight() {
        view.wantsLayer = true
        let bounds = view.bounds
        let inset = bounds.insetBy(dx: bounds.width * hitInsetX, dy: bounds.height * hitInsetY)
        let color = NSColor(calibratedRed: 0.45, green: 0.85, blue: 1.0, alpha: 0.9).cgColor
        highlight.frame = bounds
        highlight.path = CGPath(ellipseIn: inset, transform: nil)
        highlight.fillColor = NSColor.clear.cgColor
        highlight.strokeColor = color
        highlight.lineWidth = 3
        highlight.shadowColor = color
        highlight.shadowRadius = 14
        highlight.shadowOpacity = 0.9
        highlight.shadowOffset = .zero
        highlight.masksToBounds = false
        highlight.isHidden = true
        view.layer?.addSublayer(highlight)
    }

    private func showHighlight(_ visible: Bool) {
        // No implicit fade — this is a discrete state flip, and the Metal view
        // redraws every frame so an animated layer would flicker against it.
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        highlight.isHidden = !visible
        CATransaction.commit()
    }

    private func log(_ message: String) {
        FileHandle.standardError.write(Data("[avatar] \(message)\n".utf8))
    }
}
