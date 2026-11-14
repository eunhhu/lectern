import XCTest
@testable import LecternKit

/// UploadQueue against FakeUploadServer (P6-A3 §6): the part plan, resuming, the server as the
/// source of truth, idempotency keys, and what each kind of error does to a job.
final class UploadQueueTests: XCTestCase {
    var container: URL!
    var server: FakeUploadServer!

    override func setUpWithError() throws {
        container = FileManager.default.temporaryDirectory.appendingPathComponent("upload-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: container.appendingPathComponent("Recordings"), withIntermediateDirectories: true)
        server = FakeUploadServer()
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: container)
    }

    /// A recording of `bytes` bytes in the container, and its job.
    func job(bytes: Int = 10, id: String = UUID().uuidString.lowercased(), recordedAt: Date? = nil) throws -> UploadJob {
        let path = "Recordings/\(id).m4a"
        try Data((0..<bytes).map { UInt8($0 % 251) }).write(to: container.appendingPathComponent(path))
        return UploadJob(id: id, fileRelativePath: path, fileName: "lecture.m4a", mimeType: "audio/mp4", byteCount: Int64(bytes), workspaceID: "ws", recordedAt: recordedAt)
    }

    func queue() -> UploadQueue {
        UploadQueue(store: .inContainer(container), transport: server, containerURL: container)
    }

    func state(_ queue: UploadQueue, _ id: String) async -> UploadJob.State? {
        await queue.jobs().first { $0.id == id }?.state
    }

    func puts(_ part: Int) -> Int {
        server.calls.filter { if case let .put(_, p) = $0 { p == part } else { false } }.count
    }

    // MARK: - Plan

    func testPartRanges() {
        XCTAssertEqual(partRanges(byteCount: 10, partSize: 4), [0..<4, 4..<8, 8..<10])
        XCTAssertEqual(partRanges(byteCount: 0, partSize: 4), [])
        XCTAssertEqual(partRanges(byteCount: 8, partSize: 4).count, 2)
        XCTAssertEqual(partRanges(byteCount: 3, partSize: 4), [0..<3])
    }

    func testRemainingParts() {
        XCTAssertEqual(remainingParts(total: 5, done: [1, 3]), [2, 4, 5])
        XCTAssertEqual(remainingParts(total: 0, done: []), [])
        XCTAssertEqual(remainingParts(total: 2, done: [2, 1]), [])
    }

    // MARK: - Runs

    func testThreePartUpload() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        await q.run()
        XCTAssertEqual(server.calls, [
            .create(key: j.id), .put(uploadID: "upl_1", part: 1), .put(uploadID: "upl_1", part: 2), .put(uploadID: "upl_1", part: 3),
            .complete(uploadID: "upl_1", key: j.id),
        ])
        let stateNow = await state(q, j.id)
        XCTAssertEqual(stateNow, .done(recordingID: "rec_upl_1"))
    }

    func testResumeSkipsFinishedParts() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        server.fail(.transport("offline")) { $0 == .put(uploadID: "upl_1", part: 2) }
        await q.run()
        let waiting = await state(q, j.id)
        XCTAssertEqual(waiting, .waitingForNetwork)
        await q.run()
        XCTAssertEqual(puts(1), 1)
        XCTAssertEqual(puts(2), 2)
        XCTAssertEqual(puts(3), 1)
        let done = await state(q, j.id)
        XCTAssertEqual(done, .done(recordingID: "rec_upl_1"))
        XCTAssertTrue(server.calls.contains(.status(uploadID: "upl_1")))
    }

    func testServerIsTheSourceOfTruth() async throws {
        var j = try job()
        j.uploadID = "upl_9"
        j.partSize = 4
        j.files = [UploadFilePlan(relativePath: j.fileRelativePath, byteCount: 10, firstPart: 1, partCount: 3)]
        j.partsDone = [1, 2]
        j.state = .uploading
        server.seedSession(uploadID: "upl_9", partCount: 3, received: [1])
        let q = queue()
        try await q.enqueue(j)
        await q.run()
        XCTAssertEqual(server.calls, [
            .status(uploadID: "upl_9"), .put(uploadID: "upl_9", part: 2), .put(uploadID: "upl_9", part: 3), .complete(uploadID: "upl_9", key: j.id),
        ])
        let done = await state(q, j.id)
        XCTAssertEqual(done, .done(recordingID: "rec_upl_9"))
    }

    func testSameIdempotencyKey() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        server.fail(.server(status: 503, code: nil, message: nil)) { if case .create = $0 { true } else { false } }
        server.fail(.transport("offline")) { if case .complete = $0 { true } else { false } }
        await q.run()  // create fails
        await q.run()  // create, parts, complete fails
        await q.run()  // status, complete
        let keys = server.calls.compactMap { call -> String? in
            switch call {
            case let .create(key), let .complete(_, key): key
            default: nil
            }
        }
        XCTAssertEqual(keys.count, 4)
        XCTAssertTrue(keys.allSatisfy { $0 == j.id })
        let done = await state(q, j.id)
        XCTAssertEqual(done, .done(recordingID: "rec_upl_1"))
    }

    func testSessionGoneRestarts() async throws {
        var j = try job()
        j.uploadID = "upl_gone"
        j.partSize = 4
        j.files = [UploadFilePlan(relativePath: j.fileRelativePath, byteCount: 10, firstPart: 1, partCount: 3)]
        j.partsDone = [1, 2, 3]
        let q = queue()
        try await q.enqueue(j)
        await q.run()
        XCTAssertEqual(server.calls.first, .status(uploadID: "upl_gone"))
        // The old key may still point at the deleted session, so the new one gets a new key.
        XCTAssertEqual(server.calls[1], .create(key: "\(j.id).1"))
        XCTAssertEqual(server.received("upl_1"), [1, 2, 3])
        let done = await state(q, j.id)
        XCTAssertEqual(done, .done(recordingID: "rec_upl_1"))
    }

    func testQuotaExceededFailsWithServerMessage() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        server.fail(.quotaExceeded(message: "이번 달 녹음 시간을 다 썼습니다."), times: 99) { if case .create = $0 { true } else { false } }
        await q.run()
        let failed = await state(q, j.id)
        XCTAssertEqual(failed, .failed(message: "이번 달 녹음 시간을 다 썼습니다."))
        let count = server.calls.count
        await q.run()
        XCTAssertEqual(server.calls.count, count)
    }

    func testTooLargeAndUnsupportedFail() async throws {
        let q = queue()
        let a = try job()
        let b = try job()
        try await q.enqueue(a)
        try await q.enqueue(b)
        server.fail(.server(status: 413, code: "payload_too_large", message: "파일이 너무 큽니다.")) { $0 == .create(key: a.id) }
        server.fail(.server(status: 415, code: "unsupported_media_type", message: nil)) { $0 == .create(key: b.id) }
        await q.run()
        let stateA = await state(q, a.id)
        let stateB = await state(q, b.id)
        XCTAssertEqual(stateA, .failed(message: "파일이 너무 큽니다."))
        XCTAssertEqual(stateB, .failed(message: UploadQueue.rejectedMessage))
    }

    func testGivesUpAfterEightAttempts() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        server.fail(.server(status: 503, code: nil, message: nil), times: 99) { if case .create = $0 { true } else { false } }
        for run in 1...8 {
            await q.run()
            let job = await q.jobs().first!
            XCTAssertEqual(job.attempts, run)
            XCTAssertTrue(job.state.isRunnable, "run \(run)")
        }
        await q.run()
        let failed = await state(q, j.id)
        XCTAssertEqual(failed, .failed(message: UploadQueue.gaveUpMessage))
    }

    func testUnauthorizedWaitsWithoutCounting() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        server.fail(.unauthorized) { $0 == .put(uploadID: "upl_1", part: 1) }
        await q.run()
        let job = await q.jobs().first!
        XCTAssertEqual(job.attempts, 0)
        XCTAssertTrue(job.state.isRunnable)
        await q.run()
        let done = await state(q, j.id)
        XCTAssertEqual(done, .done(recordingID: "rec_upl_1"))
    }

    func testMissingFile() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        try FileManager.default.removeItem(at: container.appendingPathComponent(j.fileRelativePath))
        await q.run()
        let failed = await state(q, j.id)
        XCTAssertEqual(failed, .failed(message: "녹음 파일을 찾을 수 없습니다."))
        XCTAssertEqual(server.calls, [])
    }

    func testOneAtATime() async throws {
        server.putDelay = 0.01
        let q = queue()
        let a = try job()
        let b = try job()
        try await q.enqueue(a)
        try await q.enqueue(b)
        async let first: Void = q.run()
        async let second: Void = q.run()
        _ = await (first, second)
        await q.run()
        var seen = Set<String>()
        for case let .put(upload, part) in server.calls {
            XCTAssertTrue(seen.insert("\(upload):\(part)").inserted, "\(upload) part \(part) sent twice")
        }
        let states = await q.jobs().map(\.state)
        XCTAssertEqual(Set(states.map { "\($0)" }).count, 2)
        XCTAssertTrue(states.allSatisfy { if case .done = $0 { true } else { false } })
    }

    func testFailedJobKeepsItsFile() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        server.fail(.quotaExceeded(message: "한도")) { if case .create = $0 { true } else { false } }
        await q.run()
        let file = container.appendingPathComponent(j.fileRelativePath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
        try await q.remove(j.id)
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path), "removing a failed job keeps the recording")
        let left = await q.jobs()
        XCTAssertEqual(left, [])
    }

    func testDoneJobFileGoesOnRemove() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        await q.run()
        let file = container.appendingPathComponent(j.fileRelativePath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path), "done keeps the file until remove")
        try await q.remove(j.id)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testRetryAfterFailure() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        server.fail(.quotaExceeded(message: "한도")) { if case .create = $0 { true } else { false } }
        await q.run()
        try await q.retry(j.id)
        await q.run()
        let done = await state(q, j.id)
        XCTAssertEqual(done, .done(recordingID: "rec_upl_1"))
    }

    func testPdfsGoInTheSameSession() async throws {
        var j = try job(bytes: 6)
        let pdf = "Recordings/\(j.id).pdf"
        try Data(repeating: 7, count: 5).write(to: container.appendingPathComponent(pdf))
        j.pdfRelativePaths = [pdf]
        let q = queue()
        try await q.enqueue(j)
        await q.run()
        // 6 bytes → parts 1–2 (audio), 5 bytes → parts 3–4 (pdf).
        XCTAssertEqual(server.received("upl_1"), [1, 2, 3, 4])
        let saved = await q.jobs().first!
        XCTAssertEqual(saved.files.map(\.firstPart), [1, 3])
        let markersSent = server.calls.contains { if case .markers = $0 { true } else { false } }
        XCTAssertFalse(markersSent)
    }

    func testMarkersAreSentAfterCompletion() async throws {
        var j = try job()
        j.markers = [Marker(atMs: 1000), Marker(atMs: 5000, label: "시험")]
        let q = queue()
        try await q.enqueue(j)
        await q.run()
        XCTAssertEqual(server.calls.last, .markers(recordingID: "rec_upl_1", count: 2))
    }

    func testUpdatesStream() async throws {
        let q = queue()
        let j = try job()
        var iterator = q.updates.makeAsyncIterator()
        try await q.enqueue(j)
        let first = await iterator.next()
        XCTAssertEqual(first?.map(\.id), [j.id])
    }

    // MARK: - Dead sessions, markers, removal (review)

    func testExpiredSessionStartsOverWithANewKey() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        server.fail(.transport("offline")) { $0 == .put(uploadID: "upl_1", part: 2) }
        await q.run()
        server.expire("upl_1")  // offline for more than a day
        await q.run()
        XCTAssertTrue(server.calls.contains(.create(key: "\(j.id).1")))
        XCTAssertEqual(server.received("upl_2"), [1, 2, 3])
        let done = await state(q, j.id)
        XCTAssertEqual(done, .done(recordingID: "rec_upl_2"))
        XCTAssertTrue(server.calls.contains(.complete(uploadID: "upl_2", key: "\(j.id).1")))
    }

    func testPartRefusedAsFinishedStartsOver() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        server.fail(.server(status: 409, code: "conflict", message: "이미 끝났거나 취소된 업로드입니다.")) { $0 == .put(uploadID: "upl_1", part: 2) }
        await q.run()
        let waiting = await q.jobs().first!
        XCTAssertNil(waiting.uploadID)
        XCTAssertEqual(waiting.sessionGeneration, 1)
        XCTAssertTrue(waiting.state.isRunnable)
        await q.run()
        let done = await state(q, j.id)
        XCTAssertEqual(done, .done(recordingID: "rec_upl_2"))
    }

    func testMarkersRetriedAfterFailure() async throws {
        var j = try job()
        j.markers = [Marker(atMs: 1000)]
        let q = queue()
        try await q.enqueue(j)
        server.fail(.transport("offline")) { if case .markers = $0 { true } else { false } }
        await q.run()
        let afterFirst = await q.jobs().first!
        XCTAssertEqual(afterFirst.state, .done(recordingID: "rec_upl_1"))
        XCTAssertEqual(afterFirst.markers.count, 1)
        await q.run()
        let afterSecond = await q.jobs().first!
        XCTAssertEqual(afterSecond.markers, [])
        XCTAssertEqual(server.calls.filter { if case .markers = $0 { true } else { false } }.count, 2)
        await q.run()
        XCTAssertEqual(server.calls.filter { if case .markers = $0 { true } else { false } }.count, 2)
    }

    func testRemoveDuringRunStaysRemoved() async throws {
        server.putDelay = 0.05
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        let running = Task { await q.run() }
        try await Task.sleep(nanoseconds: 20_000_000)
        try await q.remove(j.id)
        await running.value
        let left = await q.jobs()
        XCTAssertEqual(left, [])
        XCTAssertEqual(UploadQueueStore.inContainer(container).load(), [])
    }

    func testLostCompleteResponseDoesNotStartASecondRecording() async throws {
        server.dropNextCompleteResponse = true
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        await q.run()
        let waiting = await state(q, j.id)
        XCTAssertEqual(waiting, .waitingForNetwork)
        await q.run()
        let done = await state(q, j.id)
        XCTAssertEqual(done, .done(recordingID: "rec_upl_1"))
        XCTAssertEqual(server.calls.filter { if case .create = $0 { true } else { false } }.count, 1)
        XCTAssertEqual(server.calls.filter { if case .put = $0 { true } else { false } }.count, 3)
        XCTAssertEqual(server.calls.last, .complete(uploadID: "upl_1", key: j.id))
    }
}

/// Handing a job to the background session (BackgroundUploader) and back.
extension UploadQueueTests {
    func testClaimMakesTheSessionAndGivesTheFirstPart() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        let claimed = await q.claimForBackground(j.id)
        XCTAssertEqual(claimed?.uploadID, "upl_1")
        XCTAssertEqual(claimed?.part, 1)
        XCTAssertEqual(server.calls, [.create(key: j.id)])  // no part sent by the queue itself
        let stateNow = await state(q, j.id)
        XCTAssertEqual(stateNow, .uploading)
    }

    func testRunLeavesAClaimedJobAlone() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        _ = await q.claimForBackground(j.id)
        await q.run()
        XCTAssertEqual(server.calls, [.create(key: j.id)])
        let second = await q.claimForBackground(j.id)  // already handed over
        XCTAssertNil(second)

        await q.markPartDone(j.id, part: 1)
        await q.releaseFromBackground(j.id)
        await q.run()  // asks the server, sends what it lacks, completes
        let stateNow = await state(q, j.id)
        XCTAssertEqual(stateNow, .done(recordingID: "rec_upl_1"))
        XCTAssertEqual(server.calls.filter { if case .create = $0 { true } else { false } }.count, 1)
    }

    func testRunSkipsJobsInFlightAfterARelaunch() async throws {
        let q = queue()
        let a = try job(id: "a")
        let b = try job(id: "b")
        try await q.enqueue(a)
        try await q.enqueue(b)
        await q.run(skipping: ["a"])
        let stateA = await state(q, "a")
        let stateB = await state(q, "b")
        XCTAssertEqual(stateA, .queued)
        XCTAssertEqual(stateB, .done(recordingID: "rec_upl_1"))
    }

    func testClaimOfAMissingFileFailsTheJob() async throws {
        let q = queue()
        let j = try job()
        try await q.enqueue(j)
        try FileManager.default.removeItem(at: container.appendingPathComponent(j.fileRelativePath))
        let claimed = await q.claimForBackground(j.id)
        XCTAssertNil(claimed)
        let stateNow = await state(q, j.id)
        XCTAssertEqual(stateNow, .failed(message: UploadQueue.missingFileMessage))
    }
}
