import Foundation

/// The renderer-agnostic seam the socket subscriber talks to: every character
/// model — Spine (`SpineModel`) or Live2D (`Live2DModel`) — accepts the same
/// semantic `AvatarCommand` stream. The mapping from token to authored
/// animation/expression/motion lives inside each concrete model (the
/// renderer-agnostic invariant from the avatar protocol), so `main.swift` and
/// the subscriber never branch on the renderer.
protocol AvatarModel: AnyObject {
    func apply(_ command: AvatarCommand)
}
