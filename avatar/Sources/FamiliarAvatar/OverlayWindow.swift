import AppKit
import MetalKit

/// A borderless, transparent, always-on-top window that draws over everything —
/// including a true-fullscreen app's Space — using the config proven by the
/// Phase 0.1 spike: level CGShieldingWindowLevel + collectionBehavior
/// [.canJoinAllSpaces, .fullScreenAuxiliary].
final class OverlayWindow: NSWindow {
    override var canBecomeKey: Bool { true }   // so it can receive the quit key / be dragged
    override var canBecomeMain: Bool { false }

    init(contentRect: NSRect) {
        super.init(contentRect: contentRect,
                   styleMask: [.borderless],
                   backing: .buffered,
                   defer: false)

        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = NSWindow.Level(rawValue: Int(CGShieldingWindowLevel()))
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isMovableByWindowBackground = false // we drive dragging from the view
        ignoresMouseEvents = true           // pass-through by default; the
                                            // EngagementController flips this on engage
    }
}

/// The Metal view for the character. Mouse events only reach it while the
/// EngagementController has the window engaged (pass-through is off); a drag on
/// her body repositions the whole window — the pet's "free drag". The controller
/// decides whether a given press is a drag (on her body) or a click-away (on a
/// transparent corner) and refreshes the auto-release timeout when a drag ends.
final class DraggableMetalView: MTKView {
    weak var engagement: EngagementController?

    override func mouseDown(with event: NSEvent) {
        guard let engagement else {
            window?.performDrag(with: event)
            return
        }
        if engagement.viewMouseDown(event) {
            window?.performDrag(with: event)   // synchronous: runs its own drag loop
            engagement.viewInteractionEnded()
        }
    }
}
