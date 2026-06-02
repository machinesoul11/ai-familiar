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
        ignoresMouseEvents = false
    }
}

/// The Metal view for the character. In interactive (non-click-through) mode,
/// dragging anywhere on it repositions the whole window — the pet's "free drag".
final class DraggableMetalView: MTKView {
    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}
