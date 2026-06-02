import Foundation

/// The decoded form of one NDJSON frame produced by the daemon's
/// `encodeAvatarCommand` (src/avatarBackend.ts). The wire contract is:
///   {"kind":"state","phase":"idle|working|blocked|done","ready":bool}
///   {"kind":"expression","mood":"neutral|happy|thinking|alert"}
///   {"kind":"thought","text":...}
/// one JSON object per '\n'-terminated line.
///
/// `phase`/`mood` are kept as raw strings (not Swift enums) so future vocabulary
/// growth on the daemon side never breaks the decoder — the renderer maps known
/// tokens and ignores unknown ones (see SpineModel).
enum AvatarCommand {
    case state(phase: String, ready: Bool)
    case expression(mood: String)
    case thought(text: String)

    /// Parse one complete NDJSON line. Returns nil for blank lines, malformed
    /// JSON, missing required fields, or unknown `kind` — the subscriber simply
    /// drops those (forward-compatible, never crashes the stream).
    init?(jsonLine: String) {
        let trimmed = jsonLine.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let data = trimmed.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let kind = obj["kind"] as? String
        else { return nil }

        switch kind {
        case "state":
            guard let phase = obj["phase"] as? String else { return nil }
            // strict ready coercion mirrors the daemon channel: only true is true
            let ready = (obj["ready"] as? Bool) == true
            self = .state(phase: phase, ready: ready)
        case "expression":
            guard let mood = obj["mood"] as? String else { return nil }
            self = .expression(mood: mood)
        case "thought":
            guard let text = obj["text"] as? String else { return nil }
            self = .thought(text: text)
        default:
            return nil // unknown kind: ignore
        }
    }
}
