import AVFAudio
import XCTest
@testable import RecorderKit

/// The real sink and converter, on synthetic audio (no microphone).
final class AudioFileTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("sink-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    private var fileFormat: AVAudioFormat {
        AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44_100, channels: 1, interleaved: false)!
    }

    private func sine(_ format: AVAudioFormat, frames: AVAudioFrameCount, startingAt offset: Int = 0) -> AVAudioPCMBuffer {
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        for channel in 0..<Int(format.channelCount) {
            let samples = buffer.floatChannelData![channel]
            for i in 0..<Int(frames) {
                samples[i] = 0.3 * sin(2 * .pi * 440 * Float(offset + i) / Float(format.sampleRate))
            }
        }
        return buffer
    }

    func testFileSinkWritesReadableAAC() throws {
        let url = directory.appendingPathComponent("rec.m4a")
        let sink = FileAudioSink(freeBytes: { _ in 10_000_000_000 })
        try sink.open(url: url, sampleRate: 44_100, channels: 1)
        for i in 0..<10 {
            try sink.write(sine(fileFormat, frames: 4410, startingAt: i * 4410))
        }
        XCTAssertEqual(sink.framesWritten, 44_100)
        try sink.close()

        let file = try AVAudioFile(forReading: url)
        XCTAssertEqual(file.fileFormat.sampleRate, 44_100)
        XCTAssertEqual(file.fileFormat.channelCount, 1)
        XCTAssertEqual(file.fileFormat.settings[AVFormatIDKey] as? Int, Int(kAudioFormatMPEG4AAC))
        XCTAssertEqual(Double(file.length), 44_100, accuracy: 2048)  // AAC priming and padding
    }

    func testFileSinkWritesTwoChannels() throws {
        let stereo = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 44_100, channels: 2, interleaved: false)!
        let url = directory.appendingPathComponent("dual.m4a")
        let sink = FileAudioSink(freeBytes: { _ in 10_000_000_000 })
        try sink.open(url: url, sampleRate: 44_100, channels: 2)
        for i in 0..<10 {
            try sink.write(sine(stereo, frames: 4410, startingAt: i * 4410))
        }
        try sink.close()

        let file = try AVAudioFile(forReading: url)
        XCTAssertEqual(file.fileFormat.channelCount, 2)
        XCTAssertEqual(Double(file.length), 44_100, accuracy: 2048)
        XCTAssertEqual(FileAudioSink.settings(sampleRate: 44_100, channels: 2)[AVEncoderBitRateKey] as? Int, 128_000)
        XCTAssertEqual(FileAudioSink.settings(sampleRate: 44_100, channels: 1)[AVEncoderBitRateKey] as? Int, 64_000)
    }

    func testFileSinkRefusesLowDisk() {
        let sink = FileAudioSink(freeBytes: { _ in 199 * 1024 * 1024 })
        XCTAssertThrowsError(try sink.open(url: directory.appendingPathComponent("rec.m4a"), sampleRate: 44_100, channels: 1)) {
            XCTAssertEqual($0 as? RecorderError, .lowDiskSpace)
            XCTAssertEqual($0.localizedDescription, "저장 공간이 부족해 녹음을 시작할 수 없습니다.")
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("rec.m4a").path))
    }

    func testFileSinkRejectsOtherFormats() throws {
        let sink = FileAudioSink(freeBytes: { _ in nil })
        try sink.open(url: directory.appendingPathComponent("rec.m4a"), sampleRate: 44_100, channels: 1)
        let stereo48k = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, channels: 2, interleaved: false)!
        XCTAssertThrowsError(try sink.write(sine(stereo48k, frames: 480))) {
            XCTAssertEqual($0 as? RecorderError, .formatMismatch)
        }
        try sink.close()
        XCTAssertThrowsError(try sink.write(sine(fileFormat, frames: 441))) {
            XCTAssertEqual($0 as? RecorderError, .notRecording)
        }
    }

    func testConverterTurns48kStereoInto44kMonoOverManyBuffers() throws {
        let stereo48k = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, channels: 2, interleaved: false)!
        let converter = BufferConverter(outputFormat: fileFormat)
        var total = 0
        for i in 0..<10 {
            guard let out = try converter.convert(sine(stereo48k, frames: 4800, startingAt: i * 4800)) else { continue }
            XCTAssertEqual(out.format, fileFormat)
            total += Int(out.frameLength)
        }
        // One second in, about one second out: a converter that stopped after the first buffer
        // would give about 4410.
        XCTAssertEqual(Double(total), 44_100, accuracy: 512)
    }

    func testConverterPassesTheFileFormatThrough() throws {
        let converter = BufferConverter(outputFormat: fileFormat)
        let buffer = sine(fileFormat, frames: 4410)
        let out = try converter.convert(buffer)
        XCTAssertTrue(out === buffer)
    }

    func testConverterFollowsAFormatChange() throws {
        let converter = BufferConverter(outputFormat: fileFormat)
        let stereo48k = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, channels: 2, interleaved: false)!
        let mono16k = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!
        var total = 0
        for i in 0..<5 { total += Int(try converter.convert(sine(stereo48k, frames: 4800, startingAt: i * 4800))?.frameLength ?? 0) }
        for i in 0..<5 { total += Int(try converter.convert(sine(mono16k, frames: 1600, startingAt: i * 1600))?.frameLength ?? 0) }
        XCTAssertEqual(Double(total), 44_100, accuracy: 1024)
    }
}
