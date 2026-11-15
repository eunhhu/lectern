import XCTest
@testable import RecorderKit

final class RecordingClockTests: XCTestCase {
    func testClockRemovesPauses() {
        var clock = RecordingClock()
        clock.start(at: 0)
        clock.pause(at: 10)
        clock.resume(at: 25)
        XCTAssertEqual(clock.elapsedMs(at: 40), 25_000)
    }

    func testClockDuringPause() {
        var clock = RecordingClock()
        clock.start(at: 0)
        clock.pause(at: 10)
        XCTAssertEqual(clock.elapsedMs(at: 18), 10_000)
    }

    func testClockIgnoresBackwardsTime() {
        var clock = RecordingClock()
        clock.start(at: 10)
        XCTAssertEqual(clock.elapsedMs(at: 5), 0)
        clock.pause(at: 4)  // ignored
        XCTAssertEqual(clock.elapsedMs(at: 12), 2_000)
    }

    func testClockBeforeStart() {
        XCTAssertEqual(RecordingClock().elapsedMs(at: 100), 0)
    }
}
