import Foundation

/// Connects to the daemon's avatar publish socket (a Unix domain socket at
/// $FAMILIAR_HOME/avatar.sock), reads the byte stream, splits it on '\n', decodes
/// each line into an AvatarCommand, and delivers it on the main queue.
///
/// Publish-only (we never write). Resilient: if the socket doesn't exist yet or
/// the publisher restarts, it retries with a fixed backoff — so the avatar can be
/// launched before the daemon/harness exists. This is the Swift mirror of the
/// 4.2a Node loopback subscriber.
final class SocketSubscriber {
    private let path: String
    private let onCommand: (AvatarCommand) -> Void
    private let queue = DispatchQueue(label: "com.familiar.avatar.socket")
    private var running = false
    private let backoff: TimeInterval = 1.0

    init(path: String, onCommand: @escaping (AvatarCommand) -> Void) {
        self.path = path
        self.onCommand = onCommand
    }

    func start() {
        running = true
        queue.async { [weak self] in self?.loop() }
    }

    func stop() {
        running = false
    }

    private func loop() {
        while running {
            let fd = connectOnce()
            if fd < 0 {
                Thread.sleep(forTimeInterval: backoff)
                continue
            }
            FileHandle.standardError.write(Data("[avatar] connected to \(path)\n".utf8))
            readLoop(fd)
            close(fd)
            if running {
                FileHandle.standardError.write(Data("[avatar] socket closed, reconnecting…\n".utf8))
                Thread.sleep(forTimeInterval: backoff)
            }
        }
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

    private func readLoop(_ fd: Int32) {
        var buffer = [UInt8]()
        var chunk = [UInt8](repeating: 0, count: 8192)
        while running {
            let n = chunk.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
            if n <= 0 { return } // EOF or error
            buffer.append(contentsOf: chunk[0..<n])

            while let nl = buffer.firstIndex(of: 0x0A) {
                let lineBytes = Array(buffer[buffer.startIndex..<nl])
                buffer.removeSubrange(buffer.startIndex...nl)
                guard let line = String(bytes: lineBytes, encoding: .utf8),
                      let command = AvatarCommand(jsonLine: line)
                else { continue }
                DispatchQueue.main.async { [weak self] in
                    self?.onCommand(command)
                }
            }
        }
    }
}
