import XCTest
@testable import LecternKit

/// The queue folder (P6-A3 §6): round trip, a broken entry set aside, atomic writes.
final class UploadQueueStoreTests: XCTestCase {
    var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("queue-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func sample(_ n: Int, state: UploadJob.State = .queued) -> UploadJob {
        var job = UploadJob(
            id: "job-\(n)", fileRelativePath: "Recordings/\(n).m4a", fileName: "\(n).m4a", mimeType: "audio/mp4", byteCount: Int64(1000 * n),
            workspaceID: "ws", folderID: n == 2 ? "folder" : nil, title: n == 3 ? "자료구조" : nil,
            recordedAt: Date(timeIntervalSince1970: 1_790_000_000), pdfRelativePaths: n == 1 ? ["Recordings/1.pdf"] : [],
            markers: [Marker(atMs: 1500, label: "시험")], now: Date(timeIntervalSince1970: 1_790_000_000 + Double(n))
        )
        job.state = state
        job.uploadID = n == 2 ? "upl_2" : nil
        job.partsDone = n == 2 ? [1, 3] : []
        return job
    }

    func testQueueRoundTrip() throws {
        let store = UploadQueueStore(directory: directory)
        let jobs = [sample(1), sample(2, state: .done(recordingID: "rec_2")), sample(3, state: .failed(message: "한도"))]
        for job in jobs { try store.save(job) }
        XCTAssertEqual(UploadQueueStore(directory: directory).load(), jobs)
    }

    func testCorruptEntryIsSetAside() throws {
        let store = UploadQueueStore(directory: directory)
        try store.save(sample(1))
        try store.save(sample(2))
        let broken = directory.appendingPathComponent("broken.json")
        try Data("{ not json".utf8).write(to: broken)
        XCTAssertEqual(store.load().map(\.id), ["job-1", "job-2"])
        XCTAssertFalse(FileManager.default.fileExists(atPath: broken.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: broken.path + ".corrupt"))
    }

    func testAtomicWrite() throws {
        let store = UploadQueueStore(directory: directory)
        let original = sample(1)
        try store.save(original)
        // A crash in the middle of the next save leaves only its temporary file behind.
        try Data("{\"id\":\"job-1\",\"stat".utf8).write(to: directory.appendingPathComponent(".job-1.crashed.tmp"))
        XCTAssertEqual(store.load(), [original])
        // A finished save replaces the entry as a whole.
        var changed = original
        changed.partsDone = [1, 2]
        try store.save(changed)
        XCTAssertEqual(store.load(), [changed])
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: directory.path).filter { $0.hasSuffix(".tmp") && !$0.contains("crashed") }
        XCTAssertEqual(leftovers, [])
    }

    func testDelete() throws {
        let store = UploadQueueStore(directory: directory)
        try store.save(sample(1))
        try store.delete("job-1")
        try store.delete("job-1")  // twice is fine
        XCTAssertEqual(store.load(), [])
    }
}
