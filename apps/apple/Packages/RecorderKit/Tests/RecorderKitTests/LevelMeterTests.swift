import XCTest
@testable import RecorderKit

final class LevelMeterTests: XCTestCase {
    func testDbfsOfSilenceAndFullScale() {
        let zeros = [Float](repeating: 0, count: 1024)
        let ones = [Float](repeating: 1, count: 1024)
        zeros.withUnsafeBufferPointer { XCTAssertEqual(dbfs(samples: $0), -120) }
        ones.withUnsafeBufferPointer { XCTAssertEqual(dbfs(samples: $0), 0, accuracy: 0.01) }
        [Float]().withUnsafeBufferPointer { XCTAssertEqual(dbfs(samples: $0), -120) }
    }

    func testNormalizedLevelClamps() {
        XCTAssertEqual(normalizedLevel(dbfs: -80), 0)
        XCTAssertEqual(normalizedLevel(dbfs: -30), 0.5, accuracy: 0.0001)
        XCTAssertEqual(normalizedLevel(dbfs: 5), 1)
    }

    func testSilenceWarningAfter20s() {
        var detector = SilenceDetector()
        for i in 1...40 {
            let warning = detector.feed(dbfs: -70, duration: 0.5)
            XCTAssertEqual(warning, i == 40, "buffer \(i)")
        }
    }

    func testSilenceWarningClears() {
        var detector = SilenceDetector()
        for _ in 1...40 { _ = detector.feed(dbfs: -70, duration: 0.5) }
        XCTAssertFalse(detector.feed(dbfs: -20, duration: 0.5))
        XCTAssertFalse(detector.feed(dbfs: -70, duration: 0.5))  // counting starts over
    }

    func testLevelThrottleKeepsAudioPace() {
        var throttle = LevelThrottle(sampleRate: 44_100)
        // 2205 frames = 50 ms: one value every second buffer, the louder of the two.
        XCTAssertNil(throttle.feed(dbfs: -40, frames: 2205))
        XCTAssertEqual(throttle.feed(dbfs: -50, frames: 2205)!, normalizedLevel(dbfs: -40), accuracy: 0.0001)
        XCTAssertNil(throttle.feed(dbfs: -10, frames: 2205))
        XCTAssertEqual(throttle.feed(dbfs: -30, frames: 2205)!, normalizedLevel(dbfs: -10), accuracy: 0.0001)
        // One 4410-frame buffer is a value by itself.
        XCTAssertNotNil(throttle.feed(dbfs: -30, frames: 4410))
    }
}
