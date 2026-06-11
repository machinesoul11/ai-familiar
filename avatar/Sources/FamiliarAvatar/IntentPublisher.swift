import Foundation

/// Writes avatar INTENTS upstream to the daemon's intent socket (a Unix domain
/// socket at $FAMILIAR_HOME/intent.sock) — the reverse direction of the avatar.sock
/// the SocketSubscriber reads. This is the Swift half of the 4.4 touch channel: the
/// overlay stays dumb and emits a *semantic intent*; the daemon decides what it does
/// (v0: a tap → "pull-recap", which replays the latest landed recap aloud).
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

    /// Emit the v0 "pull-recap" intent (the only intent in the vocabulary so far).
    func sendPullRecap() {
        send(line: "{\"kind\":\"avatar-intent\",\"intent\":\"pull-recap\"}\n")
    }

    private func send(line: String) {
        queue.async { [weak self] in self?.connectWriteClose(line) }
    }

    private func connectWriteClose(_ line: String) {
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
        FileHandle.standardError.write(Data("[avatar] intent sent: pull-recap\n".utf8))
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
