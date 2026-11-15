@testable import LecternKit
import XCTest

final class WidgetSnapshotTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("widgets-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    private func documents(_ count: Int) -> [WidgetSnapshot.Document] {
        (0..<count).map { WidgetSnapshot.Document(id: "rec_\($0)", title: "강의 \($0)", date: Date(timeIntervalSince1970: TimeInterval(1_792_000_000 + $0))) }
    }

    func testWidgetSnapshotRoundTrip() throws {
        let store = WidgetSnapshotStore(containerURL: directory)
        let snapshot = WidgetSnapshot(recent: documents(7), processing: [.init(id: "rec_p", title: "처리 중인 강의", stageLabel: "전사 중")])
        try store.write(snapshot)
        let read = store.read()
        XCTAssertEqual(read, snapshot)
        XCTAssertEqual(read.recent.count, 5)
        XCTAssertEqual(read.recent.map(\.id), ["rec_0", "rec_1", "rec_2", "rec_3", "rec_4"])
    }

    func testWidgetSnapshotCorruptFile() throws {
        let store = WidgetSnapshotStore(containerURL: directory)
        try Data("{not json".utf8).write(to: store.fileURL)
        XCTAssertEqual(store.read(), .empty)
        XCTAssertEqual(WidgetSnapshotStore(containerURL: directory.appendingPathComponent("missing")).read(), .empty)
    }

    func testWidgetSnapshotClearedOnLogout() throws {
        let store = WidgetSnapshotStore(containerURL: directory)
        try store.write(WidgetSnapshot(recent: documents(1)))
        store.clear()
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.fileURL.path))
    }

    // MARK: - Beyond the spec

    func testSnapshotFromAList() {
        let date = Date(timeIntervalSince1970: 1_792_000_000)
        func recording(_ id: String, _ status: RecordingStatus) -> RecordingSummary {
            RecordingSummary(id: id, workspaceID: "ws_1", folderID: nil, title: id, status: status, durationMs: nil, recordedAt: date, createdAt: date, updatedAt: date, excerpt: nil, progress: nil)
        }
        let snapshot = WidgetSnapshot(recordings: [recording("a", .ready), recording("b", .processing), recording("c", .failed), recording("d", .partial), recording("e", .queued)])
        XCTAssertEqual(snapshot.recent.map(\.id), ["a", "d"])
        XCTAssertEqual(snapshot.processing.map(\.id), ["b", "e"])
        XCTAssertEqual(snapshot.processing.map(\.stageLabel), ["처리 중", "처리 대기 중"])
    }
}
