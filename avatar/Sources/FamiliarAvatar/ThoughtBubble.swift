import AppKit

/// A glanceable, mouse-transparent "thought bubble" that shows the avatar's
/// silent inner-thought text — the 4.1 `avatar-thought` command, the unspoken
/// twin of the audio channel (text the avatar SHOWS but never speaks). It sits
/// above whatever character model is drawing (Spine or Live2D) and is driven
/// straight off the `AvatarCommand` stream, so neither `SpineModel` nor
/// `Live2DModel` has to know about it — the renderer-agnostic invariant from the
/// avatar protocol holds (the models keep ignoring `.thought`; this overlay owns
/// the display).
///
/// The view sizes the pill to its (wrapped) text and never intercepts a click,
/// so the pet's pass-through / double-click-to-engage behaviour is untouched.
final class ThoughtBubbleView: NSView {
    private let label = NSTextField(wrappingLabelWithString: "")
    private let insetX: CGFloat = 14
    private let insetY: CGFloat = 9

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedWhite: 0.0, alpha: 0.74).cgColor
        layer?.cornerRadius = 13
        layer?.masksToBounds = false
        // Drop shadow so the pill separates from any desktop content behind it.
        layer?.shadowColor = NSColor.black.cgColor
        layer?.shadowOpacity = 0.45
        layer?.shadowRadius = 8
        layer?.shadowOffset = CGSize(width: 0, height: -2)
        // Hairline border lifts it off dark backgrounds too.
        layer?.borderColor = NSColor(calibratedWhite: 1.0, alpha: 0.14).cgColor
        layer?.borderWidth = 1

        label.isEditable = false
        label.isSelectable = false
        label.isBordered = false
        label.drawsBackground = false
        label.alignment = .center
        label.textColor = .white
        label.font = .systemFont(ofSize: 14, weight: .medium)
        label.maximumNumberOfLines = 4          // glanceable, not a paragraph
        label.lineBreakMode = .byWordWrapping
        label.cell?.truncatesLastVisibleLine = true
        // Faint glyph shadow for extra contrast over busy desktops.
        let glyphShadow = NSShadow()
        glyphShadow.shadowColor = NSColor.black.withAlphaComponent(0.6)
        glyphShadow.shadowBlurRadius = 3
        glyphShadow.shadowOffset = NSSize(width: 0, height: -1)
        label.shadow = glyphShadow
        addSubview(label)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// Mouse-transparent: never intercept a click, so pass-through / drag is
    /// unaffected whether or not the window is currently interactive.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    /// Set the text and size the pill to fit it (wrapped to `maxWidth`), returning
    /// the new size so the controller can place it. Sizing lives here; placement
    /// is the controller's job.
    @discardableResult
    func setText(_ text: String, maxWidth: CGFloat) -> NSSize {
        label.stringValue = text
        let textMax = max(40, maxWidth - insetX * 2)
        label.preferredMaxLayoutWidth = textMax
        var textSize = label.fittingSize
        textSize.width = min(ceil(textSize.width), textMax)
        textSize.height = ceil(textSize.height)
        label.frame = NSRect(x: insetX, y: insetY, width: textSize.width, height: textSize.height)
        let size = NSSize(width: textSize.width + insetX * 2,
                          height: textSize.height + insetY * 2)
        setFrameSize(size)
        return size
    }
}

/// Drives the bubble off the `AvatarCommand` stream and owns its show / hold /
/// fade lifecycle: a thought fades in, holds, then auto-fades after
/// `holdSeconds`; a newer thought replaces the current one (cancelling the
/// pending fade-out); empty / whitespace-only text hides it.
///
/// The bubble lives in its OWN borderless transparent **child window** floating
/// just above the avatar window, not as a subview — because the character fills
/// her window (her head sits at the window's top), so anything drawn inside
/// would cover her face. A child window can float above her head, outside the
/// avatar window's bounds, and — being a child — it tracks the avatar window
/// automatically when she's dragged, stays click-through, and never steals key.
final class ThoughtBubbleController {
    private let bubble = ThoughtBubbleView(frame: .zero)
    private let bubbleWindow: NSWindow
    private unowned let parent: NSWindow
    private let holdSeconds: TimeInterval
    private let fadeSeconds: TimeInterval = 0.28
    private let pad: CGFloat = 12          // breathing room so the drop shadow isn't clipped
    private let sideMargin: CGFloat = 16   // keeps the pill narrower than the avatar window
    private let headroomDip: CGFloat = 24  // how far the window's bottom dips below the avatar's top edge
    private var hideWork: DispatchWorkItem?

    init(parent: NSWindow, holdSeconds: TimeInterval = 6.0) {
        self.parent = parent
        self.holdSeconds = holdSeconds

        let container = NSView(frame: .zero)
        container.wantsLayer = true

        bubbleWindow = NSWindow(contentRect: .zero, styleMask: [.borderless], backing: .buffered, defer: false)
        bubbleWindow.isOpaque = false
        bubbleWindow.backgroundColor = .clear
        bubbleWindow.hasShadow = false
        bubbleWindow.ignoresMouseEvents = true     // purely visual, never intercepts
        bubbleWindow.level = parent.level
        bubbleWindow.collectionBehavior = parent.collectionBehavior
        bubbleWindow.contentView = container
        bubbleWindow.alphaValue = 0                 // the window itself fades
        container.addSubview(bubble)

        // A child window follows the parent on drag and stays ordered above it.
        parent.addChildWindow(bubbleWindow, ordered: .above)
    }

    /// The single entry point off the socket stream. Ignores everything except a
    /// `.thought` — state / expression stay the model's concern.
    func apply(_ command: AvatarCommand) {
        guard case let .thought(text) = command else { return }
        present(text)
    }

    private func present(_ raw: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { hide(); return }

        let maxBubbleWidth = parent.frame.width - sideMargin * 2
        let size = bubble.setText(text, maxWidth: maxBubbleWidth)
        bubble.setFrameOrigin(NSPoint(x: pad, y: pad))

        let winW = size.width + pad * 2
        let winH = size.height + pad * 2
        // Centred on her, floating just above her head: the window's bottom sits
        // a hair below the avatar window's top edge (where her head is), growing
        // upward as the text wraps so longer thoughts never reach down onto her.
        var originX = parent.frame.midX - winW / 2
        let originY = parent.frame.maxY - headroomDip
        if let vf = parent.screen?.visibleFrame {   // keep it on-screen if she's near an edge
            originX = min(max(originX, vf.minX + 4), vf.maxX - winW - 4)
        }
        bubbleWindow.setFrame(NSRect(x: originX, y: originY, width: winW, height: winH), display: true)

        fade(to: 1)
        hideWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.hide() }
        hideWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + holdSeconds, execute: work)
    }

    private func hide() {
        hideWork?.cancel()
        hideWork = nil
        fade(to: 0)
    }

    private func fade(to target: CGFloat) {
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = fadeSeconds
            bubbleWindow.animator().alphaValue = target
        }
    }
}
