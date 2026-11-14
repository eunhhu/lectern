import Foundation
import LecternKit
@testable import LecternIntents
import RecorderKit
import XCTest

final class RecordingSessionTests: XCTestCase {
    private var directory: URL!
    private var input: FakeAudioInput!
    private var sink: FakeAudioSink!
    private var clock: FakeClock!
    private var activity: FakeActivity!
    private var enqueue: FakeEnqueue!
    private var hookLog: HookLog!
    private var recordersMade = 0
    private let t0 = Date(timeIntervalSince1970: 1_792_387_800)
    private let draft = RecordingDraft(workspaceID: "ws_1", folderID: "fld_os", title: nil, folderName: "운영체제")

    override func setUp() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("session-\(UUID().uuidString)", isDirectory: true)
        input = FakeAudioInput()
        sink = FakeAudioSink()
        clock = FakeClock(t0)
        enqueue = FakeEnqueue()
        hookLog = HookLog()
        recordersMade = 0
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    private func session(activityEnabled: Bool = true) -> RecordingSession {
        activity = FakeActivity(enabled: activityEnabled)
        let input = input!, sink = sink!, directory = directory!, clock = clock!, enqueue = enqueue!
        return RecordingSession(
            makeRecorder: { [self] in
                recordersMade += 1
                return Recorder(input: input, sink: sink, directory: directory, now: { clock.now })
            },
            activity: activity,
            enqueue: { result, draft in try await enqueue(result, draft) },
            now: { clock.now },
            hooks: hookLog.hooks
        )
    }

    private func until(_ condition: () async -> Bool) async {
        for _ in 0..<400 where !(await condition()) {
            try? await Task.sleep(nanoseconds: 5_000_000)
        }
    }

    // MARK: - Spec (§6)

    func testStartBeginsActivity() async throws {
        let s = session()
        try await s.start(draft: draft)
        let calls = await activity.calls
        XCTAssertEqual(calls, [.start(title: "운영체제", state: .init(phase: .recording, startedAt: t0))])
        let state = await s.currentState
        XCTAssertEqual(state?.phase, .recording)
        XCTAssertEqual(state?.markerCount, 0)
        XCTAssertEqual(hookLog.active, [true])
        let active = await s.isActive
        XCTAssertTrue(active)
    }

    func testStartTwiceIsOneRecording() async throws {
        let s = session()
        try await s.start(draft: draft)
        try await s.start(draft: draft)
        XCTAssertEqual(recordersMade, 1)
        let starts = await activity.starts
        XCTAssertEqual(starts, 1)
    }

    func testPauseFreezesElapsed() async throws {
        let s = session()
        try await s.start(draft: draft)
        input.send(100)  // 10 s
        await s.pause()
        await until { await s.currentState?.phase == .paused }
        let state = await s.currentState
        XCTAssertEqual(state?.phase, .paused)
        XCTAssertEqual(state?.pausedElapsedMs, 10_000)
        XCTAssertEqual(state?.elapsedDisplay, .fixed("0:10"))
    }

    func testResumeAdjustsTimerStart() async throws {
        let s = session()
        try await s.start(draft: draft)
        input.send(100)
        clock.advance(10)
        await s.pause()
        await until { await s.currentState?.phase == .paused }
        clock.advance(30)
        let t = clock.now
        await s.resume()
        await until { await s.currentState?.phase == .recording }
        let state = await s.currentState
        XCTAssertEqual(state?.startedAt, t.addingTimeInterval(-10))
        XCTAssertNil(state?.pausedElapsedMs)
        XCTAssertEqual(hookLog.activated, 2)  // start and resume
    }

    func testTimerStartHelper() {
        XCTAssertEqual(timerStart(now: t0, recordedMs: 65_000), t0.addingTimeInterval(-65))
    }

    func testMarkerUpdatesCount() async throws {
        let s = session()
        try await s.start(draft: draft)
        input.send(10)
        await s.addMarker()
        await s.addMarker()
        let updates = await activity.updates
        XCTAssertEqual(updates.count, 2)
        XCTAssertEqual(updates.last?.markerCount, 2)
    }

    func testLevelsDoNotUpdateActivity() async throws {
        let s = session()
        try await s.start(draft: draft)
        input.send(100)
        try await Task.sleep(nanoseconds: 100_000_000)
        let updates = await activity.updates
        XCTAssertEqual(updates.count, 0)
    }

    func testSilenceWarningUpdatesOnceEachWay() async throws {
        let s = session()
        try await s.start(draft: draft)
        input.send(210, value: 0)  // 21 s of silence
        await until { await activity.updates.count == 1 }
        input.send(1, value: 0.1)
        await until { await activity.updates.count == 2 }
        let updates = await activity.updates
        XCTAssertEqual(updates.map(\.silenceWarning), [true, false])
    }

    func testStopEnqueuesUpload() async throws {
        let s = session()
        try await s.start(draft: draft)
        input.send(30)
        await s.addMarker()
        input.send(20)
        let result = try await s.stop()
        XCTAssertNotNil(result)
        let received = await enqueue.received
        XCTAssertEqual(received.count, 1)
        XCTAssertEqual(received.first?.0.markers, [RecordedMarker(atMs: 3000, label: nil)])
        XCTAssertEqual(received.first?.0.startedAt, t0)
        XCTAssertEqual(received.first?.1, draft)
        let ends = await activity.ends
        XCTAssertEqual(ends.count, 1)
        XCTAssertEqual(ends.first?.0.phase, .uploading)
        XCTAssertEqual(ends.first?.0.pausedElapsedMs, 5000)
        XCTAssertEqual(ends.first?.1, RecordingSession.endDelay)
        XCTAssertEqual(hookLog.active, [true, false])
        XCTAssertEqual(hookLog.deactivated, 1)
        let active = await s.isActive
        XCTAssertFalse(active)
    }

    func testShortRecordingIsDiscarded() async throws {
        let s = session()
        try await s.start(draft: draft)
        input.send(10)  // 1 s
        let result = try await s.stop()
        XCTAssertNil(result)
        let received = await enqueue.received
        XCTAssertEqual(received.count, 0)
        let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        XCTAssertEqual(files, [])
        let ends = await activity.ends
        XCTAssertEqual(ends.first?.0.phase, .finished)
        XCTAssertEqual(ends.first?.1, 0)
    }

    func testEnqueueFailureKeepsTheFile() async throws {
        let s = session()
        try await s.start(draft: draft)
        input.send(50)
        await enqueue.failNext(FakeError())
        do {
            try await s.stop()
            XCTFail("no error")
        } catch {
            XCTAssertTrue(error is FakeError)
        }
        let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        XCTAssertEqual(files.count, 1)
        let active = await s.isActive
        XCTAssertFalse(active)
    }

    func testActivityDisabledStillRecords() async throws {
        let s = session(activityEnabled: false)
        try await s.start(draft: draft)
        input.send(50)
        await s.addMarker()
        try await s.stop()
        let received = await enqueue.received
        XCTAssertEqual(received.count, 1)
        let calls = await activity.calls
        XCTAssertEqual(calls.count, 1)  // the refused start only: no update, no end
    }

    func testIntentsWithoutActiveRecordingSucceed() async throws {
        let s = session()
        try await RecordingActions.stop(session: s)
        await RecordingActions.addMarker(session: s)
        await RecordingActions.togglePause(session: s)
        try await RecordingActions.stop(session: nil)
        await RecordingActions.addMarker(session: nil)
        await RecordingActions.togglePause(session: nil)
        let calls = await activity.calls
        XCTAssertEqual(calls, [])
    }

    func testStartWithoutLoginFails() async {
        let defaults = UserDefaults(suiteName: "intents-\(UUID().uuidString)")!
        do {
            try await RecordingActions.start(session: session(), defaults: defaults)
            XCTFail("started")
        } catch {
            XCTAssertTrue(error.localizedDescription.hasPrefix("로그인이 필요합니다."), error.localizedDescription)
        }
        XCTAssertEqual(recordersMade, 0)
    }

    // MARK: - Beyond the spec

    func testConcurrentStartsMakeOneRecording() async throws {
        let s = session()
        async let first: Void = s.start(draft: draft)
        async let second: Void = s.start(draft: draft)
        _ = try await (first, second)
        XCTAssertEqual(recordersMade, 1)
    }

    func testMicrophoneDenied() async {
        hookLog.permission = false
        let s = session()
        do {
            try await s.start(draft: draft)
            XCTFail("started")
        } catch {
            XCTAssertEqual(error as? RecordingError, .microphoneDenied)
            XCTAssertEqual(error.localizedDescription, "마이크 권한이 필요합니다. 설정에서 Lectern의 마이크를 켜 주세요.")
        }
        XCTAssertEqual(recordersMade, 0)
        let active = await s.isActive
        XCTAssertFalse(active)
    }

    func testRecorderFailureEndsTheSession() async throws {
        let s = session()
        try await s.start(draft: draft)
        input.send(20)
        sink.failWrites = true
        input.send(1)
        await until { await !s.isActive }
        let active = await s.isActive
        XCTAssertFalse(active)
        let failure = await s.lastFailure
        XCTAssertNotNil(failure)
        let ends = await activity.ends
        XCTAssertEqual(ends.first?.0.phase, .finished)
        XCTAssertEqual(hookLog.active, [true, false])
        XCTAssertEqual(hookLog.deactivated, 1)
        let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        XCTAssertEqual(files.count, 1)  // kept

        sink.failWrites = false
        try await s.start(draft: draft)  // a new recording works
        XCTAssertEqual(recordersMade, 2)
    }

    func testStopWhileInactiveClearsTheControl() async throws {
        let s = session()
        try await RecordingActions.setRecording(false, session: s, defaults: nil)
        XCTAssertEqual(hookLog.active, [false])
    }

    func testLaunchCleanupEndsLeftovers() async {
        let s = session()
        await s.cleanUpAfterLaunch()
        let calls = await activity.calls
        XCTAssertEqual(calls, [.endLeftovers])
        XCTAssertEqual(hookLog.active, [false])
    }

    func testStatesStreamStartsWithTheCurrentState() async throws {
        let s = session()
        try await s.start(draft: draft)
        var iterator = s.states.makeAsyncIterator()
        let first = await iterator.next()
        XCTAssertEqual(first?.phase, .recording)
        input.send(30)
        try await s.stop()
        let later = s.states  // after the end: starts empty, not on the finished recording
        let task = Task { () -> Bool in
            var it = later.makeAsyncIterator()
            return await it.next() != nil
        }
        try await Task.sleep(nanoseconds: 50_000_000)
        task.cancel()
        let gotOne = await task.value
        XCTAssertFalse(gotOne)
    }
}

final class RecordingValuesTests: XCTestCase {
    func testClockText() {
        XCTAssertEqual(RecordingActivityAttributes.clockText(0), "0:00")
        XCTAssertEqual(RecordingActivityAttributes.clockText(59_999), "0:59")
        XCTAssertEqual(RecordingActivityAttributes.clockText(725_000), "12:05")
        XCTAssertEqual(RecordingActivityAttributes.clockText(3_725_000), "1:02:05")
    }

    func testElapsedDisplayAndStatus() {
        let at = Date(timeIntervalSince1970: 1_792_387_800)
        var state = RecordingActivityAttributes.ContentState(phase: .recording, startedAt: at)
        XCTAssertEqual(state.elapsedDisplay, .timer(since: at))
        XCTAssertEqual(state.statusText, "녹음 중")
        state.phase = .paused
        state.pausedElapsedMs = 65_000
        XCTAssertEqual(state.elapsedDisplay, .fixed("1:05"))
        XCTAssertEqual(state.statusText, "일시정지됨")
        state.phase = .uploading
        XCTAssertEqual(state.statusText, "올리는 중")
    }

    func testActivityTitle() {
        XCTAssertEqual(RecordingDraft(workspaceID: "ws").activityTitle, "새 녹음")
        XCTAssertEqual(RecordingDraft(workspaceID: "ws", folderName: "운영체제").activityTitle, "운영체제")
        XCTAssertEqual(RecordingDraft(workspaceID: "ws", title: "3주차", folderName: "운영체제").activityTitle, "3주차")
    }

    func testUploadJobFromRecording() throws {
        let container = FileManager.default.temporaryDirectory.appendingPathComponent("container-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: container) }
        let recordings = container.appendingPathComponent("Recordings", isDirectory: true)
        try FileManager.default.createDirectory(at: recordings, withIntermediateDirectories: true)
        let file = recordings.appendingPathComponent("rec-20261019-143000.m4a")
        try Data(count: 1234).write(to: file)
        let at = Date(timeIntervalSince1970: 1_792_387_800)
        let result = RecordingResult(fileURL: file, durationMs: 60_000, markers: [RecordedMarker(atMs: 3000, label: "시험")], startedAt: at)
        let job = try UploadJob.recording(result, draft: RecordingDraft(workspaceID: "ws_1", folderID: "fld_os"), containerURL: container)
        XCTAssertEqual(job.fileRelativePath, "Recordings/rec-20261019-143000.m4a")
        XCTAssertEqual(job.fileName, "rec-20261019-143000.m4a")
        XCTAssertEqual(job.mimeType, "audio/mp4")
        XCTAssertEqual(job.byteCount, 1234)
        XCTAssertEqual(job.workspaceID, "ws_1")
        XCTAssertEqual(job.folderID, "fld_os")
        XCTAssertEqual(job.recordedAt, at)
        XCTAssertEqual(job.markers, [Marker(atMs: 3000, label: "시험")])
        XCTAssertEqual(job.state, .queued)
    }

    func testUploadJobMovesAFileFromOutside() throws {
        let container = FileManager.default.temporaryDirectory.appendingPathComponent("container-\(UUID().uuidString)", isDirectory: true)
        let outside = FileManager.default.temporaryDirectory.appendingPathComponent("outside-\(UUID().uuidString).m4a")
        defer {
            try? FileManager.default.removeItem(at: container)
            try? FileManager.default.removeItem(at: outside)
        }
        try Data(count: 10).write(to: outside)
        let result = RecordingResult(fileURL: outside, durationMs: 5000, markers: [], startedAt: Date())
        let job = try UploadJob.recording(result, draft: RecordingDraft(workspaceID: "ws"), containerURL: container)
        XCTAssertEqual(job.fileRelativePath, "Recordings/\(outside.lastPathComponent)")
        XCTAssertTrue(FileManager.default.fileExists(atPath: container.appendingPathComponent(job.fileRelativePath).path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: outside.path))
    }
}
