import XCTest
@testable import RecorderKit

final class RecorderStateTests: XCTestCase {
    func testTransitionTable() {
        let rows: [(RecorderState, RecorderEvent, RecorderState)] = [
            (.idle, .start, .recording),
            (.recording, .pause, .paused(reason: .user)),
            (.recording, .interruptionBegan, .paused(reason: .interruption)),
            (.recording, .routeLost, .paused(reason: .routeLost)),
            (.paused(reason: .user), .resume, .recording),
            (.paused(reason: .interruption), .interruptionEnded(shouldResume: true), .recording),
            (.paused(reason: .interruption), .interruptionEnded(shouldResume: false), .paused(reason: .user)),
            (.paused(reason: .interruption), .resume, .recording),
            (.paused(reason: .routeLost), .routeRestored, .recording),
            (.paused(reason: .routeLost), .resume, .recording),
            (.recording, .stop, .stopping),
            (.paused(reason: .user), .stop, .stopping),
            (.paused(reason: .interruption), .stop, .stopping),
            (.paused(reason: .routeLost), .stop, .stopping),
            (.stopping, .finishedWriting, .finished),
            (.recording, .sinkFailed("x"), .failed(message: "x")),
            (.paused(reason: .user), .sinkFailed("x"), .failed(message: "x")),
            (.paused(reason: .interruption), .sinkFailed("x"), .failed(message: "x")),
            (.paused(reason: .routeLost), .sinkFailed("x"), .failed(message: "x")),
            (.stopping, .sinkFailed("x"), .failed(message: "x")),
        ]
        for (state, event, expected) in rows {
            XCTAssertEqual(reduce(state, event), expected, "\(state) + \(event)")
        }
    }

    func testUnlistedEventsAreIgnored() {
        XCTAssertEqual(reduce(.idle, .pause), .idle)
        XCTAssertEqual(reduce(.finished, .start), .finished)
        XCTAssertEqual(reduce(.paused(reason: .user), .interruptionEnded(shouldResume: true)), .paused(reason: .user))
        XCTAssertEqual(reduce(.paused(reason: .user), .routeRestored), .paused(reason: .user))
        XCTAssertEqual(reduce(.failed(message: "x"), .resume), .failed(message: "x"))
        XCTAssertEqual(reduce(.idle, .sinkFailed("x")), .idle)
        XCTAssertEqual(reduce(.recording, .start), .recording)
    }

    func testUserPauseSurvivesInterruptionEnd() {
        var state = RecorderState.recording
        for event in [RecorderEvent.pause, .interruptionBegan, .interruptionEnded(shouldResume: true)] {
            state = reduce(state, event)
        }
        XCTAssertEqual(state, .paused(reason: .user))
    }

    func testSessionEventMapping() {
        XCTAssertEqual(SessionEvents.interruption(type: 1, options: 0), .interruptionBegan)
        XCTAssertEqual(SessionEvents.interruption(type: 0, options: 1), .interruptionEnded(shouldResume: true))
        XCTAssertEqual(SessionEvents.interruption(type: 0, options: 0), .interruptionEnded(shouldResume: false))
        XCTAssertNil(SessionEvents.interruption(type: 7, options: 0))
        XCTAssertEqual(SessionEvents.routeChange(reason: 2), .routeLost)
        XCTAssertEqual(SessionEvents.routeChange(reason: 1), .routeRestored)
        XCTAssertNil(SessionEvents.routeChange(reason: 3))  // category change
    }
}
