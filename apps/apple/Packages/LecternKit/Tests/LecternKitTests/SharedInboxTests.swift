import Foundation
@testable import LecternKit
import XCTest

final class SharedInboxTests: XCTestCase {
    private var root: URL!
    private var container: URL!
    private var source: URL!
    private var store: UploadQueueStore!
    private let seoul = TimeZone(identifier: "Asia/Seoul")!
    private let now = Date(timeIntervalSince1970: 1_792_400_000)

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("inbox-\(UUID().uuidString)", isDirectory: true)
        container = root.appendingPathComponent("container", isDirectory: true)
        source = root.appendingPathComponent("shared", isDirectory: true)
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        store = .inContainer(container)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func shared(_ name: String, bytes: Int = 100) throws -> URL {
        let url = source.appendingPathComponent(name)
        try Data(count: bytes).write(to: url)
        return url
    }

    private func inbox(
        free: Int64? = nil,
        size: (@Sendable (URL) -> Int64?)? = nil,
        recordedDate: @escaping @Sendable (URL, Date) async -> Date? = { _, _ in nil }
    ) -> SharedInbox {
        SharedInbox(
            containerURL: container,
            store: store,
            freeBytes: { _ in free },
            fileSize: size ?? { SharedInbox.size(of: $0) },
            recordedDate: recordedDate
        )
    }

    private func importing(_ urls: [URL], into inbox: SharedInbox? = nil) async throws -> ImportSummary {
        try await (inbox ?? self.inbox()).importFiles(urls, workspaceID: "ws_1", folderID: nil, timeZone: seoul, now: now)
    }

    // MARK: - Spec (§6)

    func testAudioBecomesOneJob() async throws {
        let audio = try shared("운영체제 7주차.m4a")
        let summary = try await importing([audio])
        XCTAssertEqual(summary, ImportSummary(recordings: 1, pdfsPaired: 0, pdfsUnpaired: 0, ignored: []))
        let jobs = store.load()
        XCTAssertEqual(jobs.count, 1)
        XCTAssertTrue(jobs[0].fileRelativePath.hasPrefix("Inbox/"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: container.appendingPathComponent(jobs[0].fileRelativePath).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: audio.path))  // the original stays
        XCTAssertEqual(jobs[0].workspaceID, "ws_1")
        XCTAssertEqual(jobs[0].mimeType, "audio/mp4")
        XCTAssertEqual(jobs[0].byteCount, 100)
        XCTAssertEqual(jobs[0].title, "운영체제 7주차")
        XCTAssertEqual(jobs[0].state, .queued)
    }

    func testAudioAndPdfArePaired() async throws {
        let summary = try await importing([try shared("운영체제 7주차.m4a"), try shared("운영체제 7주차 스케줄링.pdf")])
        XCTAssertEqual(summary.pdfsPaired, 1)
        let jobs = store.load()
        XCTAssertEqual(jobs.count, 1)
        XCTAssertEqual(jobs[0].pdfRelativePaths.count, 1)
        XCTAssertTrue(jobs[0].pdfRelativePaths[0].hasSuffix("/운영체제 7주차 스케줄링.pdf"))
    }

    func testPdfAloneIsNotQueued() async throws {
        let summary = try await importing([try shared("slides.pdf")])
        XCTAssertEqual(summary, ImportSummary(recordings: 0, pdfsPaired: 0, pdfsUnpaired: 1, ignored: []))
        XCTAssertEqual(store.load().count, 0)
    }

    func testUnsupportedFilesAreIgnored() async throws {
        let summary = try await importing([try shared("notes.txt"), try shared("a.m4a")])
        XCTAssertEqual(summary.ignored, ["notes.txt"])
        XCTAssertEqual(summary.recordings, 1)
    }

    func testRecordedAtFromFileName() async throws {
        _ = try await importing([try shared("Recording_20261019_143005.m4a")])
        XCTAssertEqual(store.load().first?.recordedAt, Date(timeIntervalSince1970: 1_792_387_800))  // 14:30 KST
    }

    func testNameIsSanitised() async throws {
        let file = try shared("b.m4a")
        let summary = try await inbox().importItems([SharedInbox.Item(url: file, name: "../a/b.m4a")], workspaceID: "ws_1", folderID: nil, timeZone: seoul, now: now)
        XCTAssertEqual(summary.recordings, 1)
        let path = try XCTUnwrap(store.load().first?.fileRelativePath)
        let components = path.split(separator: "/")
        XCTAssertEqual(components.count, 3)
        XCTAssertEqual(components[0], "Inbox")
        XCTAssertFalse(components[2].contains("/"))
        XCTAssertFalse(components[2].hasPrefix("."))
        XCTAssertEqual(components[2], "_a_b.m4a")
    }

    func testNoSpace() async throws {
        let audio = try shared("a.m4a")
        do {
            _ = try await importing([audio], into: inbox(free: 10))
            XCTFail("imported")
        } catch {
            XCTAssertEqual(error as? SharedInboxError, .noSpace)
            XCTAssertEqual(error.localizedDescription, "기기의 저장 공간이 부족합니다.")
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: container.appendingPathComponent("Inbox").path))
        XCTAssertEqual(store.load().count, 0)
    }

    func testOversizedAudioIsIgnored() async throws {
        let big = try shared("big.m4a")
        let small = try shared("small.m4a")
        let threeGB: Int64 = 3 * 1024 * 1024 * 1024
        let summary = try await importing([big, small], into: inbox(size: { $0.lastPathComponent == "big.m4a" ? threeGB : 100 }))
        XCTAssertEqual(summary.ignored, ["big.m4a"])
        XCTAssertEqual(summary.recordings, 1)
    }

    // MARK: - Beyond the spec

    func testPartsBecomeOneJobWithSeveralAudioFiles() async throws {
        _ = try await importing([try shared("자료구조 5주차 2부.m4a"), try shared("자료구조 5주차 1부.m4a"), try shared("자료구조 5주차.pdf")])
        let jobs = store.load()
        XCTAssertEqual(jobs.count, 1)
        XCTAssertTrue(jobs[0].fileRelativePath.hasSuffix("/자료구조 5주차 1부.m4a"))
        XCTAssertEqual(jobs[0].audioPartRelativePaths?.count, 1)
        XCTAssertTrue(jobs[0].audioPartRelativePaths?[0].hasSuffix("/자료구조 5주차 2부.m4a") ?? false)
        XCTAssertEqual(jobs[0].pdfRelativePaths.count, 1)
        XCTAssertEqual(jobs[0].title, "자료구조 5주차")
    }

    func testSameNamesGoToSeparateFolders() async throws {
        let one = source.appendingPathComponent("x", isDirectory: true)
        let two = source.appendingPathComponent("y", isDirectory: true)
        try FileManager.default.createDirectory(at: one, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: two, withIntermediateDirectories: true)
        try Data(count: 10).write(to: one.appendingPathComponent("녹음.m4a"))
        try Data(count: 20).write(to: two.appendingPathComponent("녹음.m4a"))
        _ = try await importing([one.appendingPathComponent("녹음.m4a"), two.appendingPathComponent("녹음.m4a")])
        let paths = store.load().map(\.fileRelativePath)
        XCTAssertEqual(paths.count, 2)
        XCTAssertEqual(Set(paths).count, 2)
    }

    func testRecordedDateFromMetadataComesFirst() async throws {
        let at = Date(timeIntervalSince1970: 1_700_000_000)
        _ = try await importing([try shared("Recording_20261019_143005.m4a")], into: inbox(recordedDate: { _, _ in at }))
        XCTAssertEqual(store.load().first?.recordedAt, at)
    }

    func testFileDateAtOrAfterTheShareIsNotTheRecordingDate() async throws {
        let file = try shared("fresh.m4a")  // created now
        let before = await recordedDate(of: file, notAfter: Date(timeIntervalSinceNow: -60))
        XCTAssertNil(before)
        let after = await recordedDate(of: file, notAfter: Date(timeIntervalSinceNow: 60))
        XCTAssertNotNil(after)
    }

    func testTheAppQueueSeesJobsTheExtensionSaved() async throws {
        let queue = UploadQueue(store: store, transport: FakeUploadServer(), containerURL: container)
        let before = await queue.jobs()
        XCTAssertEqual(before.count, 0)
        _ = try await importing([try shared("a.m4a")])
        await queue.reloadFromStore()
        let after = await queue.jobs()
        XCTAssertEqual(after.count, 1)
    }
}

extension SharedInboxTests {
    func testAFailedShareLeavesNothingQueued() async throws {
        let good = try shared("운영체제 7주차.m4a")
        let missing = source.appendingPathComponent("자료구조 5주차.m4a")  // reported as 100 bytes, cannot be copied
        let inbox = inbox(size: { _ in 100 })
        do {
            _ = try await importing([good, missing], into: inbox)
            XCTFail("imported")
        } catch {}
        XCTAssertEqual(store.load().count, 0)
        let left = (try? FileManager.default.contentsOfDirectory(atPath: container.appendingPathComponent("Inbox").path)) ?? []
        XCTAssertEqual(left, [])
    }

    func testLeftoversOlderThanADayAreRemoved() async throws {
        _ = try await importing([try shared("a.m4a")])
        let fm = FileManager.default
        let inboxDir = container.appendingPathComponent("Inbox")
        let referenced = try fm.contentsOfDirectory(atPath: inboxDir.path)
        let orphanOld = inboxDir.appendingPathComponent("orphan-old")
        let orphanNew = inboxDir.appendingPathComponent("orphan-new")
        let stagingOld = container.appendingPathComponent("ShareStaging/old")
        let stagingNew = container.appendingPathComponent("ShareStaging/new")
        for dir in [orphanOld, orphanNew, stagingOld, stagingNew] { try fm.createDirectory(at: dir, withIntermediateDirectories: true) }
        let twoDaysAgo = now.addingTimeInterval(-48 * 3600)
        for dir in [orphanOld, stagingOld] + referenced.map({ inboxDir.appendingPathComponent($0) }) {
            try fm.setAttributes([.modificationDate: twoDaysAgo], ofItemAtPath: dir.path)
        }
        for dir in [orphanNew, stagingNew] { try fm.setAttributes([.modificationDate: now], ofItemAtPath: dir.path) }
        inbox().removeLeftovers(now: now)
        XCTAssertFalse(fm.fileExists(atPath: orphanOld.path))
        XCTAssertFalse(fm.fileExists(atPath: stagingOld.path))
        XCTAssertTrue(fm.fileExists(atPath: orphanNew.path))
        XCTAssertTrue(fm.fileExists(atPath: stagingNew.path))
        for name in referenced { XCTAssertTrue(fm.fileExists(atPath: inboxDir.appendingPathComponent(name).path)) }
    }
}
