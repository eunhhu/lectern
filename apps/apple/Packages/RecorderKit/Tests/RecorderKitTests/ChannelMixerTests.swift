@testable import RecorderKit
import XCTest

final class ChannelMixerTests: XCTestCase {
    func testMixerInterleavesEqualStreams() {
        var mixer = ChannelMixer(sampleRate: 48_000)
        mixer.pushMic([1, 1, 1, 1])
        mixer.pushSystem([0.5, 0.5, 0.5, 0.5])
        let out = mixer.pull(frames: 4)
        XCTAssertEqual(out.left, [1, 1, 1, 1])
        XCTAssertEqual(out.right, [0.5, 0.5, 0.5, 0.5])
    }

    func testMixerPadsMissingSystem() {
        var mixer = ChannelMixer(sampleRate: 48_000)
        mixer.pushMic([0.1, 0.2, 0.3, 0.4])
        let out = mixer.pull(frames: 4)
        XCTAssertEqual(out.left, [0.1, 0.2, 0.3, 0.4])
        XCTAssertEqual(out.right, [0, 0, 0, 0])
    }

    func testMixerPadsMissingMic() {
        var mixer = ChannelMixer(sampleRate: 48_000)
        mixer.pushSystem([0.5, 0.5, 0.5, 0.5])
        let out = mixer.pull(frames: 4)
        XCTAssertEqual(out.left, [0, 0, 0, 0])
        XCTAssertEqual(out.right, [0.5, 0.5, 0.5, 0.5])
    }

    func testMixerPullAlwaysReturnsRequestedFrames() {
        var mixer = ChannelMixer(sampleRate: 48_000)
        let out = mixer.pull(frames: 128)
        XCTAssertEqual(out.left, [Float](repeating: 0, count: 128))
        XCTAssertEqual(out.right, [Float](repeating: 0, count: 128))
    }

    func testMixerCatchesUpAfterLag() {
        var mixer = ChannelMixer(sampleRate: 48_000)
        let halfSecond = 24_000
        for _ in 0..<(96_000 / 4800) {  // 2 s of microphone in 0.1 s pieces, no system audio
            mixer.pushMic([Float](repeating: 0.2, count: 4800))
        }
        XCTAssertLessThanOrEqual(mixer.bufferedMicFrames - mixer.bufferedSystemFrames, halfSecond)
        XCTAssertEqual(mixer.droppedSystemFrames, 0)
        XCTAssertEqual(mixer.droppedMicFrames, 0)

        // System audio that starts now lands within half a second of the end of the microphone audio.
        mixer.pushSystem([0.7, 0.7, 0.7])
        let out = mixer.drain()
        XCTAssertEqual(out.left.count, out.right.count)
        let firstSystem = out.right.firstIndex(of: 0.7)
        XCTAssertNotNil(firstSystem)
        XCTAssertLessThanOrEqual(abs((firstSystem ?? 0) - 96_000), halfSecond)
        XCTAssertEqual(Array(out.left.prefix(96_000)), [Float](repeating: 0.2, count: 96_000))  // nothing of the microphone lost
    }

    func testMixerClamps() {
        var mixer = ChannelMixer(sampleRate: 48_000)
        mixer.pushMic([2.0, -3.0])
        mixer.pushSystem([-3.0, 2.0])
        let out = mixer.pull(frames: 2)
        XCTAssertEqual(out.left, [1.0, -1.0])
        XCTAssertEqual(out.right, [-1.0, 1.0])
    }

    func testMixerDrainEqualLengths() {
        var mixer = ChannelMixer(sampleRate: 48_000)
        mixer.pushMic([0.1, 0.2, 0.3, 0.4, 0.5])
        mixer.pushSystem([0.6, 0.7, 0.8])
        let out = mixer.drain()
        XCTAssertEqual(out.left, [0.1, 0.2, 0.3, 0.4, 0.5])
        XCTAssertEqual(out.right, [0.6, 0.7, 0.8, 0, 0])
    }

    // MARK: - Beyond the spec

    func testMixerPadsAStalledMicrophone() {
        var mixer = ChannelMixer(sampleRate: 1000, maxLagSeconds: 0.5)
        mixer.pushSystem([Float](repeating: 0.5, count: 600))  // 0.6 s with no microphone
        XCTAssertEqual(mixer.bufferedMicFrames, 600)  // padded: output can go on
        let out = mixer.pull(frames: 600)
        XCTAssertEqual(out.left, [Float](repeating: 0, count: 600))
        XCTAssertEqual(out.right, [Float](repeating: 0.5, count: 600))
    }

    func testSmallLagIsNotPadded() {
        var mixer = ChannelMixer(sampleRate: 1000, maxLagSeconds: 0.5)
        mixer.pushMic([Float](repeating: 0.1, count: 400))
        XCTAssertEqual(mixer.bufferedSystemFrames, 0)
        mixer.pushSystem([Float](repeating: 0.5, count: 400))
        let out = mixer.pull(frames: 400)
        XCTAssertEqual(out.right, [Float](repeating: 0.5, count: 400))  // aligned, no silence in front
    }
}
