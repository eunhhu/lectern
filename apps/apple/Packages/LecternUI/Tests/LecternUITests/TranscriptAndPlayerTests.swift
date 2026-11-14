import LecternKit
import XCTest
@testable import LecternUI

final class TranscriptAndPlayerTests: XCTestCase {
    func testActiveSegmentBinarySearch() {
        let starts = [0, 4000, 9000]
        XCTAssertNil(activeSegmentIndex(startsMs: starts, positionMs: -1))
        XCTAssertEqual(activeSegmentIndex(startsMs: starts, positionMs: 0), 0)
        XCTAssertEqual(activeSegmentIndex(startsMs: starts, positionMs: 3999), 0)
        XCTAssertEqual(activeSegmentIndex(startsMs: starts, positionMs: 4000), 1)
        XCTAssertEqual(activeSegmentIndex(startsMs: starts, positionMs: 100_000), 2)
    }

    func testActiveSegmentEmpty() {
        XCTAssertNil(activeSegmentIndex(startsMs: [], positionMs: 0))
    }

    func testActiveSegmentLarge() {
        var generator = SystemRandomNumberGenerator()
        var start = 0
        let starts: [Int] = (0..<10_000).map { _ in
            defer { start += Int.random(in: 0...3000, using: &generator) }  // equal starts allowed
            return start
        }
        func linear(_ position: Int) -> Int? {
            starts.lastIndex { $0 <= position }
        }
        for _ in 0..<1000 {
            let position = Int.random(in: -100...(start + 100), using: &generator)
            XCTAssertEqual(activeSegmentIndex(startsMs: starts, positionMs: position), linear(position), "position \(position)")
        }
    }

    func testAutoScrollPausesUntilFiveSecondsAfterTheScrollRests() {
        let now = Date(timeIntervalSince1970: 1000)
        XCTAssertTrue(AutoScrollPolicy.shouldFollow(now: now, userScrolling: false, userScrollEndedAt: nil))
        XCTAssertFalse(AutoScrollPolicy.shouldFollow(now: now, userScrolling: true, userScrollEndedAt: nil))
        XCTAssertFalse(AutoScrollPolicy.shouldFollow(now: now, userScrolling: false, userScrollEndedAt: now.addingTimeInterval(-4.9)))
        XCTAssertTrue(AutoScrollPolicy.shouldFollow(now: now, userScrolling: false, userScrollEndedAt: now.addingTimeInterval(-5)))
    }

    func testTranscriptRowAccessibilityLabel() {
        let segment = Transcript.Segment(idx: 3, startMs: 725_000, endMs: 730_000, speakerID: "spk_1", text: "시험에 나옵니다.")
        XCTAssertEqual(TranscriptRow.accessibilityLabel(speakerName: "강사", segment: segment), "강사, 12분 5초, 시험에 나옵니다.")
        XCTAssertEqual(TranscriptRow.accessibilityLabel(speakerName: nil, segment: segment), "12분 5초, 시험에 나옵니다.")
    }

    func testClamp() {
        XCTAssertEqual(PlayerViewModel.clamp(-5, durationMs: 1000), 0)
        XCTAssertEqual(PlayerViewModel.clamp(500, durationMs: 1000), 500)
        XCTAssertEqual(PlayerViewModel.clamp(999_999, durationMs: 1000), 1000)
        XCTAssertEqual(PlayerViewModel.clamp(999_999, durationMs: 0), 999_999)  // duration not known yet
    }

    func testNextRateCycles() {
        var rate: Float = 0.75
        var seen: [Float] = [rate]
        for _ in 0..<5 {
            rate = PlayerViewModel.nextRate(after: rate)
            seen.append(rate)
        }
        XCTAssertEqual(seen, [0.75, 1, 1.25, 1.5, 2, 0.75])
        XCTAssertEqual(PlayerViewModel.nextRate(after: 1.1), 1.25)
    }

    func testRateLabels() {
        XCTAssertEqual(PlayerBar.rateText(0.75), "0.75×")
        XCTAssertEqual(PlayerBar.rateText(1), "1×")
        XCTAssertEqual(PlayerBar.rateText(1.5), "1.5×")
        XCTAssertEqual(PlayerBar.rateAccessibilityLabel(1.25), "재생 속도 1.25배")
        XCTAssertEqual(PlayerBar.rateAccessibilityLabel(2), "재생 속도 2배")
    }
}
