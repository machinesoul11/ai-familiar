// Throwaway 5.4 spike (NOT part of the build; run with `swift stt_spike.swift`).
//
// Decides whether avatar-side STT is viable in the non-bundled FamiliarAvatar
// CLI before we freeze the 5.4 contract. Probes the four things that change the
// architecture if they fail:
//   (1) does a non-bundled CLI actually get the Speech + Microphone TCC grants
//       (or does it silently deny, the way osascript notifications silently no-op
//       on macOS 26 -> would force a bundled .app helper),
//   (2) is on-device recognition supported (free, private, no Apple-server hop),
//   (3) does continuous transcription stream partial results,
//   (4) can we spot a (hardcoded, for the spike) wake word and read the command
//       that follows it.
//
// Logs everything with a [stt-spike] prefix to stderr, runs ~30s, exits.

import Foundation
import Speech
import AVFoundation

let WAKE = "computer"   // spike-only; the real wake word is user-configurable
let RUN_SECONDS = 30.0

let logURL = URL(fileURLWithPath: "/tmp/stt_spike.log")
func log(_ s: String) {
    let line = "[stt-spike] \(s)\n"
    FileHandle.standardError.write(Data(line.utf8))
    if let h = try? FileHandle(forWritingTo: logURL) {
        h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close()
    } else {
        try? line.data(using: .utf8)?.write(to: logURL)
    }
}

final class Spike {
    let engine = AVAudioEngine()
    let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    var request: SFSpeechAudioBufferRecognitionRequest?
    var task: SFSpeechRecognitionTask?
    var lastTranscript = ""

    func start() {
        guard let recognizer = recognizer else {
            log("FAIL: SFSpeechRecognizer(en-US) is nil — no recognizer for locale.")
            exit(2)
        }
        log("recognizer.isAvailable=\(recognizer.isAvailable)")
        log("recognizer.supportsOnDeviceRecognition=\(recognizer.supportsOnDeviceRecognition)")

        SFSpeechRecognizer.requestAuthorization { status in
            log("speech auth status = \(self.describe(status))")
            guard status == .authorized else {
                log("FAIL: speech recognition NOT authorized (\(self.describe(status))).")
                exit(3)
            }
            self.requestMic()
        }
    }

    func requestMic() {
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            log("microphone access granted = \(granted)")
            guard granted else {
                log("FAIL: microphone NOT granted.")
                exit(4)
            }
            DispatchQueue.main.async { self.listen() }
        }
    }

    func listen() {
        guard let recognizer = recognizer else { return }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            req.requiresOnDeviceRecognition = true
            log("requesting ON-DEVICE recognition (no network).")
        } else {
            log("WARN: on-device NOT supported — would fall back to Apple servers (privacy cost).")
        }
        self.request = req

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        log("input format: \(format.sampleRate)Hz, \(format.channelCount)ch")
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }

        engine.prepare()
        do {
            try engine.start()
            log("audio engine STARTED — speak now. Try: \"\(WAKE) recap\" then \"\(WAKE) what did I miss\".")
        } catch {
            log("FAIL: engine.start() threw: \(error)")
            exit(5)
        }

        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let text = result.bestTranscription.formattedString
                if text != self.lastTranscript {
                    self.lastTranscript = text
                    log("heard: \"\(text)\"\(result.isFinal ? "  [FINAL]" : "")")
                    self.checkWake(text)
                }
            }
            if let error = error {
                log("recognition error: \(error)")
            }
        }
    }

    func checkWake(_ text: String) {
        let lower = text.lowercased()
        guard let r = lower.range(of: WAKE) else { return }
        let after = lower[r.upperBound...].trimmingCharacters(in: .whitespaces)
        log(">>> WAKE DETECTED. command-after-wake = \"\(after)\"")
    }

    func describe(_ s: SFSpeechRecognizerAuthorizationStatus) -> String {
        switch s {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown"
        }
    }
}

let spike = Spike()
spike.start()

DispatchQueue.main.asyncAfter(deadline: .now() + RUN_SECONDS) {
    log("done (\(Int(RUN_SECONDS))s window elapsed). exiting.")
    exit(0)
}
RunLoop.main.run()
