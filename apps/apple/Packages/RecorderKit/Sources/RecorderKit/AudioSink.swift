import AVFAudio
import Foundation

/// Where recorded buffers go. `framesWritten` is the file's own time axis: markers and the
/// duration are computed from it, so they match the audio the server transcribes.
public protocol AudioSink: Sendable {
    func open(url: URL, sampleRate: Double, channels: Int) throws
    func write(_ buffer: AVAudioPCMBuffer) throws
    func close() throws
    var framesWritten: Int64 { get }
}

/// AAC in an .m4a file, the same settings as the old macOS menu-bar app (44.1 kHz, mono, 64 kbps).
///
/// An .m4a is only playable once `close()` has written its index: a recording that the process
/// dies in the middle of cannot be read back (MANUAL_CHECKS).
public final class FileAudioSink: AudioSink, @unchecked Sendable {
    public static let minimumFreeBytes: Int64 = 200 * 1024 * 1024
    public static let bitRate = 64_000

    private let lock = NSLock()
    private var file: AVAudioFile?
    private var frames: Int64 = 0
    private let freeBytes: @Sendable (URL) -> Int64?

    /// `freeBytes` answers for a directory; nil means unknown (the check is skipped).
    public init(freeBytes: @escaping @Sendable (URL) -> Int64? = FileAudioSink.availableBytes(in:)) {
        self.freeBytes = freeBytes
    }

    public static func availableBytes(in directory: URL) -> Int64? {
        let values = try? directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage
    }

    public static func settings(sampleRate: Double, channels: Int) -> [String: Any] {
        [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: channels,
            AVEncoderBitRateKey: bitRate,
        ]
    }

    public func open(url: URL, sampleRate: Double, channels: Int) throws {
        if let free = freeBytes(url.deletingLastPathComponent()), free < Self.minimumFreeBytes {
            throw RecorderError.lowDiskSpace
        }
        let opened = try AVAudioFile(
            forWriting: url,
            settings: Self.settings(sampleRate: sampleRate, channels: channels),
            commonFormat: .pcmFormatFloat32,
            interleaved: false
        )
        lock.withLock {
            file = opened
            frames = 0
        }
    }

    public func write(_ buffer: AVAudioPCMBuffer) throws {
        try lock.withLock {
            guard let file else { throw RecorderError.notRecording }
            let expected = file.processingFormat
            let actual = buffer.format
            // AVAudioFile raises an Objective-C exception on a format mismatch; Swift cannot catch it.
            guard actual.sampleRate == expected.sampleRate, actual.channelCount == expected.channelCount,
                  actual.commonFormat == expected.commonFormat, actual.isInterleaved == expected.isInterleaved
            else { throw RecorderError.formatMismatch }
            try file.write(from: buffer)
            frames += Int64(buffer.frameLength)
        }
    }

    public func close() throws {
        lock.withLock {
            file?.close()
            file = nil
        }
    }

    public var framesWritten: Int64 { lock.withLock { frames } }
}
