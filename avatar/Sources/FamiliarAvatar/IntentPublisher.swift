import Foundation

/// Writes avatar INTENTS upstream to the daemon's intent socket (a Unix domain
/// socket at $FAMILIAR_HOME/intent.sock) — the reverse direction of the avatar.sock
/// the SocketSubscriber reads. This is the Swift half of the 4.4/5.2 touch channel:
/// the overlay stays dumb and emits a *semantic intent*; the daemon decides what it
/// does. Two intents so far: a quick tap → "pull-recap" (replays the latest landed
/// recap aloud), a long-press → "recall" (the "while you were away" activity rollup).
///
/// Fire-and-forget. The daemon does NOT ack, so we connect, write one NDJSON line,
/// and close — fresh per send, since a tap is a rare user gesture and a persistent
/// fd would only add broken-pipe bookkeeping. If the daemon isn't running, the
/// connect fails and the send is a silent no-op (the pet still works without it).
///
/// The AF_UNIX connect logic mirrors SocketSubscriber.connectOnce.
final class IntentPublisher {
    private let path: String
    private let queue = DispatchQueue(label: "com.familiar.avatar.intent")

    init(path: String) {
        self.path = path
    }

    /// Emit the "pull-recap" intent — a quick tap on her body (replays the latest
    /// landed recap aloud).
    func sendPullRecap() {
        emit(intent: "pull-recap")
    }

    /// Emit the "recall" intent — a long-press on her body (5.2: speaks the "while
    /// you were away" session activity rollup). Same wire shape, distinct intent
    /// value; the daemon decides what each one does.
    func sendRecall() {
        emit(intent: "recall")
    }

    /// Encode one semantic intent as an NDJSON line and fire it upstream. The
    /// intent string is the ONLY thing that varies between gestures, drawn from a
    /// fixed trusted vocabulary (no user text → no JSON escaping needed).
    private func emit(intent: String) {
        let line = "{\"kind\":\"avatar-intent\",\"intent\":\"\(intent)\"}\n"
        queue.async { [weak self] in self?.connectWriteClose(line, intent: intent) }
    }

    private func connectWriteClose(_ line: String, intent: String) {
        let fd = connectOnce()
        if fd < 0 {
            FileHandle.standardError.write(Data("[avatar] intent: no daemon at \(path) (ignored)\n".utf8))
            return
        }
        let bytes = Array(line.utf8)
        _ = bytes.withUnsafeBytes { raw in
            write(fd, raw.baseAddress, raw.count)
        }
        close(fd)
        FileHandle.standardError.write(Data("[avatar] intent sent: \(intent)\n".utf8))
    }

    private func connectOnce() -> Int32 {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        if fd < 0 { return -1 }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)

        let pathBytes = Array(path.utf8)
        let capacity = MemoryLayout.size(ofValue: addr.sun_path)
        if pathBytes.count >= capacity {
            close(fd)
            return -1
        }
        withUnsafeMutablePointer(to: &addr.sun_path) { rawPtr in
            rawPtr.withMemoryRebound(to: CChar.self, capacity: capacity) { dst in
                for (i, byte) in pathBytes.enumerated() {
                    dst[i] = CChar(bitPattern: byte)
                }
                dst[pathBytes.count] = 0
            }
        }

        let len = socklen_t(MemoryLayout<sockaddr_un>.size)
        let result = withUnsafePointer(to: &addr) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                connect(fd, sa, len)
            }
        }
        if result < 0 {
            close(fd)
            return -1
        }
        return fd
    }
}
