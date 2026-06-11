import Foundation
import Speech
import AVFoundation

/// Always-listening, on-device speech → wake-word-gated voice commands (5.4 STT).
///
/// The avatar half of the voice talk-back channel. It is the speech-shaped
/// sibling of the touch gestures: instead of a tap/long-press, you SAY a command.
/// It transcribes continuously on-device (free, private — no Apple-server hop),
/// and ONLY when a finalized speech segment contains the user-chosen wake word
/// does it forward the text AFTER the wake word upstream via
/// `IntentPublisher.sendUtterance`. The daemon then classifies that text into an
/// action. Nothing spoken before a wake word is ever forwarded — the mic happily
/// transcribes ambient TV/podcast audio (the 5.4 spike proved this), so the
/// wake-gate is the privacy/correctness boundary, not a nicety.
///
/// PACKAGING: this requires the signed `.app` bundle (TCC reads the mic/speech
/// usage strings only from a real bundle; a bare CLI hard-crashes — see the 5.4
/// spike finding). `main.swift` gates on the usage strings being present before
/// it ever constructs this, so a normal bare-CLI dev launch never reaches here.
///
/// Segmentation: a single `SFSpeechAudioBufferRecognitionRequest` accumulates
/// forever, so we cut an utterance on a short silence — reset a timer on every
/// partial result; when it fires, the current transcript is one finished
/// utterance: gate it, then tear the request down and start a fresh one. A
/// generation counter drops callbacks from a torn-down segment. All state lives
/// on the main queue (the recognition callback hops there) so the Timer and the
/// request/task swap never race.
final class SpeechListener {
    private let wakeWord: String                 // lowercased + trimmed
    private let onCommand: (String) -> Void
    private let engine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silenceTimer: Timer?
    private var generation = 0
    private let silenceInterval: TimeInterval = 1.2

    init(wakeWord: String, onCommand: @escaping (String) -> Void) {
        self.wakeWord = SpeechListener.normalize(wakeWord)
        self.onCommand = onCommand
    }

    /// Lowercase, drop punctuation, collapse runs of whitespace — so a multi-word
    /// wake word ("hey familiar") still matches a transcript like "hey, familiar".
    private static func normalize(_ s: String) -> String {
        let spaced = String(s.lowercased().map { $0.isPunctuation ? " " : $0 })
        return spaced.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    /// Request the two grants, then start the mic. Any failure disables voice
    /// quietly (logs once) — the pet keeps working without it.
    func start() {
        guard !wakeWord.isEmpty else { log("empty wake word; voice disabled."); return }
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            guard let self else { return }
            guard status == .authorized else {
                self.log("speech recognition not authorized (status \(status.rawValue)); voice disabled.")
                return
            }
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
                guard let self else { return }
                guard granted else { self.log("microphone access denied; voice disabled."); return }
                DispatchQueue.main.async { self.beginSession() }
            }
        }
    }

    // MARK: - main-queue only below

    private func beginSession() {
        guard let recognizer, recognizer.isAvailable else {
            log("recognizer unavailable for en-US; voice disabled."); return
        }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            log("audio engine failed to start: \(error); voice disabled."); return
        }
        log("listening for wake word \"\(wakeWord)\" (on-device).")
        startSegment()
    }

    private func startSegment() {
        guard let recognizer else { return }
        generation += 1
        let gen = generation
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, gen == self.generation else { return }   // drop stale-segment callbacks
                if let result {
                    self.scheduleSilence(after: result.bestTranscription.formattedString)
                }
                if error != nil {
                    self.restartSegment()
                }
            }
        }
    }

    /// Reset the end-of-utterance timer on each partial; when speech pauses, the
    /// accumulated transcript is one finished utterance.
    private func scheduleSilence(after transcript: String) {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: silenceInterval, repeats: false) { [weak self] _ in
            self?.finalizeSegment(transcript)
        }
    }

    private func finalizeSegment(_ transcript: String) {
        silenceTimer?.invalidate(); silenceTimer = nil
        gate(transcript)
        restartSegment()
    }

    private func restartSegment() {
        silenceTimer?.invalidate(); silenceTimer = nil
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        startSegment()
    }

    /// The wake-gate: forward ONLY the command text that follows the wake word.
    private func gate(_ transcript: String) {
        let norm = SpeechListener.normalize(transcript)
        guard let r = norm.range(of: wakeWord) else { return }    // no wake word → never forward
        // NB: we deliberately do NOT log the pre-wake transcript — the mic hears
        // ambient speech (and her own TTS), and none of it should be persisted.
        let command = String(norm[r.upperBound...]).trimmingCharacters(in: .whitespaces)
        guard !command.isEmpty else { return }                    // wake word alone → nothing to do
        log("wake heard → command: \"\(command)\"")
        onCommand(command)
    }

    private func log(_ s: String) {
        FileHandle.standardError.write(Data("[avatar] voice: \(s)\n".utf8))
    }
}
