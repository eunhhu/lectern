import AVFAudio
import XCTest
@testable import RecorderKit

final class RecorderTests: XCTestCase {
    private var directory: URL!
    private var input: FakeAudioInput!
    private var sink: FakeAudioSink!

    override func setUp() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("recorder-\(UUID().uuidString)", isDirectory: true)
        input = FakeAudioInput()
        sink = FakeAudioSink()
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    private func recorder(now: Date = Date(timeIntervalSince1970: 1_792_387_800)) -> Recorder {
        Recorder(input: input, sink: sink, directory: directory, now: { now })
    }

    private func until(_ condition: () async -> Bool) async {
        for _ in 0..<200 where !(await condition()) {
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
    }

    // MARK: - Spec (§6)

    func testRecorderWritesOnlyWhileRecording() async throws {
        let r = recorder()
        _ = try await r.start()
        input.send(10)
        await r.pause()
        input.send(5)
        await r.resume()
        input.send(10)
        XCTAssertEqual(sink.buffers, 20)
    }

    func testMarkerUsesWrittenFrames() async throws {
        let r = recorder()
        _ = try await r.start()
        input.send(10)
        let first = await r.addMarker()
        await r.pause()
        input.send(5)
        await r.resume()
        input.send(10)
        let second = await r.addMarker(label: "시험 범위")
        XCTAssertEqual(first, 1000)
        XCTAssertEqual(second, 2000)
    }

    func testMarkerWhilePaused() async throws {
        let r = recorder()
        _ = try await r.start()
        input.send(10)
        await r.pause()
        input.send(5)
        let marker = await r.addMarker()
        XCTAssertEqual(marker, 1000)
    }

    func testStopReturnsResult() async throws {
        let started = Date(timeIntervalSince1970: 1_792_387_800)
        let r = recorder(now: started)
        let url = try await r.start()
        input.send(10)
        await r.addMarker()
        await r.pause()
        input.send(5)
        await r.resume()
        input.send(10)
        await r.addMarker(label: "중요")
        let result = try await r.stop()
        XCTAssertEqual(result.durationMs, 2000)
        XCTAssertEqual(result.markers, [RecordedMarker(atMs: 1000, label: nil), RecordedMarker(atMs: 2000, label: "중요")])
        XCTAssertEqual(result.fileURL, url)
        XCTAssertEqual(result.startedAt, started)
        let state = await r.state
        XCTAssertEqual(state, .finished)
        XCTAssertEqual(sink.closes, 1)
        XCTAssertEqual(input.stops, 1)
    }

    func testSinkFailure() async throws {
        let r = recorder()
        let url = try await r.start()
        input.send(3)
        sink.failWrites = true
        input.send(1)
        let state = await r.state
        XCTAssertEqual(state, .failed(message: Recorder.writeFailureMessage))
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        let kept = await r.fileURL
        XCTAssertEqual(kept, url)
        // The input stops and the file is closed (best effort) so what was written can be played.
        await until { self.input.stops > 0 && self.sink.closes > 0 }
        XCTAssertEqual(input.stops, 1)
        XCTAssertEqual(sink.closes, 1)
        do {
            _ = try await r.stop()
            XCTFail("stop after a failure")
        } catch {
            XCTAssertEqual(error as? RecorderError, .failed(Recorder.writeFailureMessage))
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
    }

    func testInterruptionPausesAndResumes() async throws {
        let r = recorder()
        _ = try await r.start()
        input.send(2)
        await r.handle(.interruptionBegan)
        input.send(3)
        XCTAssertEqual(sink.buffers, 2)
        await r.handle(.interruptionEnded(shouldResume: true))
        input.send(4)
        XCTAssertEqual(sink.buffers, 6)
        XCTAssertEqual(input.starts, 2)  // the system stopped the engine: started again
    }

    // MARK: - Restarting the input

    func testInterruptionEndedWithoutResumeThenUserResumeRestartsInput() async throws {
        let r = recorder()
        _ = try await r.start()
        await r.handle(.interruptionBegan)
        await r.handle(.interruptionEnded(shouldResume: false))
        let paused = await r.state
        XCTAssertEqual(paused, .paused(reason: .user))
        await r.resume()
        input.send(2)
        XCTAssertEqual(input.starts, 2)
        XCTAssertEqual(sink.buffers, 2)
    }

    func testUserPauseThenInterruptionRestartsOnResume() async throws {
        let r = recorder()
        _ = try await r.start()
        await r.pause()
        await r.handle(.interruptionBegan)  // ignored by the table, but the engine is stopped
        await r.handle(.interruptionEnded(shouldResume: true))
        let still = await r.state
        XCTAssertEqual(still, .paused(reason: .user))
        XCTAssertEqual(input.starts, 1)
        await r.resume()
        input.send(1)
        XCTAssertEqual(input.starts, 2)
        XCTAssertEqual(sink.buffers, 1)
    }

    func testUserPauseKeepsInputRunning() async throws {
        let r = recorder()
        _ = try await r.start()
        await r.pause()
        await r.resume()
        XCTAssertEqual(input.starts, 1)
        XCTAssertEqual(input.stops, 0)
    }

    func testFailedRestartStaysPaused() async throws {
        let r = recorder()
        _ = try await r.start()
        await r.handle(.routeLost)
        input.failStarts()
        await r.handle(.routeRestored)
        let state = await r.state
        XCTAssertEqual(state, .paused(reason: .routeLost))
        await r.resume()  // the next try works
        let after = await r.state
        XCTAssertEqual(after, .recording)
        input.send(1)
        XCTAssertEqual(sink.buffers, 1)
    }

    func testStartAndStopEventsThroughHandleAreIgnored() async throws {
        let r = recorder()
        _ = try await r.start()
        await r.handle(.stop)
        await r.handle(.finishedWriting)
        let state = await r.state
        XCTAssertEqual(state, .recording)
    }

    // MARK: - Start

    func testFileNameAndNoOverwrite() async throws {
        let at = Date(timeIntervalSince1970: 1_792_387_800)
        let first = try await recorder(now: at).start()
        let name = first.lastPathComponent
        XCTAssertTrue(name.hasPrefix("rec-") && name.hasSuffix(".m4a"), name)
        XCTAssertEqual(name.count, "rec-20261019-053000.m4a".count)
        let second = try await Recorder(input: FakeAudioInput(), sink: FakeAudioSink(), directory: directory, now: { at }).start()
        XCTAssertEqual(second.lastPathComponent, name.replacingOccurrences(of: ".m4a", with: "-2.m4a"))
    }

    func testStartFailureLeavesIdleAndNoFile() async throws {
        let r = recorder()
        input.failStarts()
        do {
            _ = try await r.start()
            XCTFail("start should throw")
        } catch {}
        let state = await r.state
        XCTAssertEqual(state, .idle)
        let left = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        XCTAssertEqual(left, [])
        _ = try await r.start()  // and it can start afterwards
        let now = await r.state
        XCTAssertEqual(now, .recording)
    }

    func testStartTwiceThrows() async throws {
        let r = recorder()
        _ = try await r.start()
        do {
            _ = try await r.start()
            XCTFail("second start")
        } catch {
            XCTAssertEqual(error as? RecorderError, .notIdle)
        }
    }

    // MARK: - Streams

    func testLevelsWhileRecordingAndZeroOnPause() async throws {
        let r = recorder()
        _ = try await r.start()
        var levels = r.levels.makeAsyncIterator()
        input.send(1, value: 0.1)  // -20 dBFS
        let level = await levels.next()
        XCTAssertEqual(level ?? -1, normalizedLevel(dbfs: -20), accuracy: 0.001)
        await r.pause()
        let paused = await levels.next()
        XCTAssertEqual(paused, 0)
        _ = try await r.stop()
        let end = await levels.next()
        XCTAssertNil(end)
    }

    func testSilenceWarningFromRecorder() async throws {
        let r = recorder()
        _ = try await r.start()
        var warnings = r.silenceWarning.makeAsyncIterator()
        let initial = await warnings.next()
        XCTAssertEqual(initial, false)
        input.send(200, value: 0)  // 20 s of silence
        let on = await warnings.next()
        XCTAssertEqual(on, true)
        input.send(1, value: 0.1)
        let off = await warnings.next()
        XCTAssertEqual(off, false)
    }

    func testSilenceDoesNotCountPausedTime() async throws {
        let r = recorder()
        _ = try await r.start()
        var warnings = r.silenceWarning.makeAsyncIterator()
        _ = await warnings.next()
        input.send(150, value: 0)
        await r.pause()
        input.send(100, value: 0)  // paused: not fed
        await r.resume()
        input.send(49, value: 0)  // 19.9 s of recorded silence in all
        input.send(1, value: 0.1)
        _ = try await r.stop()
        let rest = await warnings.next()
        XCTAssertNil(rest)  // never turned on
    }
}

final class RecorderObservationTests: XCTestCase {
    private var directory: URL!

    override func setUp() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("recorder-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    func testStateChangesKeepEveryTransition() async throws {
        let input = FakeAudioInput()
        let r = Recorder(input: input, sink: FakeAudioSink(), directory: directory)
        let states = r.stateChanges
        _ = try await r.start()
        await r.pause()
        await r.resume()  // right after the pause: both must arrive
        await r.handle(.interruptionBegan)
        _ = try await r.stop()
        var seen: [RecorderState] = []
        for await state in states { seen.append(state) }
        XCTAssertEqual(seen, [.idle, .recording, .paused(reason: .user), .recording, .paused(reason: .interruption), .stopping, .finished])
    }

    func testRecordedMsCountsWrittenFramesOnly() async throws {
        let input = FakeAudioInput()
        let r = Recorder(input: input, sink: FakeAudioSink(), directory: directory)
        _ = try await r.start()
        input.send(30)
        await r.pause()
        input.send(20)
        XCTAssertEqual(r.recordedMs, 3000)
        await r.resume()
        input.send(5)
        XCTAssertEqual(r.recordedMs, 3500)
    }
}
