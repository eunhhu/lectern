import Foundation
import LecternKit
import XCTest
@testable import LecternUI

/// A client whose answers and errors a test sets, recording each list request.
final class FakeClient: LecternClient, @unchecked Sendable {
    private let lock = NSLock()
    var pages: [String?: Page<RecordingSummary>] = [nil: Page(items: [], nextCursor: nil)]
    var listError: Error?
    var detail: RecordingDetail?
    var document: LecternKit.Document?
    var transcript: Transcript?
    var signInError: Error?
    private(set) var listRequests: [(folderID: String?, cursor: String?)] = []

    func me() async throws -> Me { FixtureClient.me }
    func workspaces() async throws -> [WorkspaceSummary] { [FixtureClient.workspace] }
    func folders(workspaceID: String) async throws -> [Folder] { FixtureClient.folders }

    func recordings(workspaceID: String, folderID: String?, cursor: String?) async throws -> Page<RecordingSummary> {
        lock.withLock { listRequests.append((folderID, cursor)) }
        if let listError { throw listError }
        return pages[cursor] ?? Page(items: [], nextCursor: nil)
    }

    func recording(id: String) async throws -> RecordingDetail {
        guard let detail else { throw APIError.notFound }
        return detail
    }

    func transcript(recordingID: String) async throws -> Transcript {
        guard let transcript else { throw APIError.notFound }
        return transcript
    }

    func document(id: String) async throws -> LecternKit.Document {
        guard let document else { throw APIError.notFound }
        return document
    }

    func audioURL(for recording: RecordingDetail) async throws -> URL? { nil }

    func signIn(email: String, password: String) async throws -> Me {
        if let signInError { throw signInError }
        return FixtureClient.me
    }

    func signIn(apiToken: String) async throws -> Me {
        if let signInError { throw signInError }
        return FixtureClient.me
    }

    func signOut() async {}
    func isSignedIn() async -> Bool { true }
}

@MainActor
final class FakePlayback: Playback {
    private(set) var seeks: [Int] = []
    private(set) var plays = 0
    func seek(toMs ms: Int) { seeks.append(ms) }
    func play() { plays += 1 }
}

@MainActor
final class ScreenViewModelTests: XCTestCase {
    private func recordings(_ count: Int, from start: Int = 0) -> [RecordingSummary] {
        (start..<(start + count)).map { i in
            let at = Date(timeIntervalSince1970: 1_792_387_800 - Double(i) * 3600)
            return RecordingSummary(
                id: "rec_\(i)", workspaceID: "ws_fixture", folderID: nil, title: "녹음 \(i)", status: .ready, durationMs: 60_000,
                recordedAt: at, createdAt: at, updatedAt: at, excerpt: nil, progress: nil
            )
        }
    }

    private func detail(_ status: RecordingStatus, document: Bool) -> RecordingDetail {
        let summary = RecordingSummary(
            id: "rec_1", workspaceID: "ws_fixture", folderID: nil, title: "녹음", status: status, durationMs: 60_000,
            recordedAt: Date(), createdAt: Date(), updatedAt: Date(), excerpt: nil, progress: nil
        )
        return RecordingDetail(
            recording: summary, assets: [],
            documents: document ? [DocumentSummary(id: "doc_1", templateID: "lecture", currentVersion: 1, updatedAt: Date())] : [],
            speakers: [], failureMessage: nil
        )
    }

    // MARK: - Library

    func testLibraryLoadsFirstPage() async {
        let client = FakeClient()
        client.pages = [nil: Page(items: recordings(8), nextCursor: nil)]
        let model = LibraryViewModel(client: client)
        await model.load()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertEqual(model.recordings.count, 8)
        XCTAssertEqual(model.workspaceID, "ws_fixture")
    }

    func testLibraryEmpty() async {
        let model = LibraryViewModel(client: FakeClient())
        await model.load()
        XCTAssertEqual(model.phase, .empty)
    }

    func testLibraryPagination() async {
        let client = FakeClient()
        let first = recordings(20)
        client.pages = [nil: Page(items: first, nextCursor: "c2"), "c2": Page(items: recordings(5, from: 20), nextCursor: nil)]
        let model = LibraryViewModel(client: client)
        await model.load()
        await model.loadMore(after: first[3])  // not the last row: nothing
        XCTAssertEqual(client.listRequests.count, 1)
        await model.loadMore(after: first.last!)
        XCTAssertEqual(model.recordings.count, 25)
        await model.loadMore(after: first.last!)  // same page again: not asked twice
        await model.loadMore(after: model.recordings.last!)  // no next cursor
        XCTAssertEqual(client.listRequests.map(\.cursor), [nil, "c2"])
    }

    func testLibraryFolderFilter() async {
        let client = FakeClient()
        let model = LibraryViewModel(client: client)
        await model.load()
        await model.selectFolder("fld_os")
        XCTAssertEqual(model.folderID, "fld_os")
        XCTAssertEqual(client.listRequests.last?.folderID, "fld_os")
        XCTAssertEqual(client.listRequests.last?.cursor, nil)
    }

    func testLibraryFailureMessage() async {
        let client = FakeClient()
        client.listError = APIError.transport("-1009")
        let model = LibraryViewModel(client: client)
        await model.load()
        XCTAssertEqual(model.phase, .failed("서버에 연결하지 못했습니다. 서버 주소와 네트워크를 확인해 주세요."))
    }

    func testUnauthorizedSignsOut() async {
        let client = FakeClient()
        client.listError = APIError.unauthorized
        let model = LibraryViewModel(client: client)
        var signedOut = 0
        model.onUnauthorized = { signedOut += 1 }
        await model.load()
        XCTAssertEqual(signedOut, 1)

        let recording = RecordingViewModel(recordingID: "rec_1", client: client)
        recording.onUnauthorized = { signedOut += 1 }
        client.detail = nil
        await recording.load()  // 404, not 401
        XCTAssertEqual(signedOut, 1)
    }

    func testStatusLabels() {
        XCTAssertEqual(ScreenText.statusLabel(.processing), "처리 중")
        XCTAssertEqual(ScreenText.statusLabel(.partial), "전사만 준비됨")
        XCTAssertEqual(ScreenText.statusLabel(.failed), "실패")
        XCTAssertNil(ScreenText.statusLabel(.ready))
        XCTAssertNil(ScreenText.statusLabel(.unknown("archived")))
    }

    func testRowAccessibilityLabel() {
        let row = recordings(1)[0]
        let seoul = TimeZone(identifier: "Asia/Seoul")!
        XCTAssertEqual(ScreenText.rowAccessibilityLabel(row, timeZone: seoul), "녹음 0, 2026년 10월 19일 오후 2:30, 1분")
        XCTAssertEqual(ScreenText.duration(4_380_000), "1시간 13분")
        XCTAssertEqual(ScreenText.duration(45_000), "45초")
        XCTAssertNil(ScreenText.duration(nil))
    }

    // MARK: - Recording

    func testRecordingStates() async {
        let client = FakeClient()
        client.detail = detail(.processing, document: false)
        var model = RecordingViewModel(recordingID: "rec_1", client: client)
        await model.load()
        XCTAssertEqual(model.documentMessage, "처리 중입니다. 끝나면 문서가 여기에 나타납니다.")

        client.detail = detail(.failed, document: false)
        model = RecordingViewModel(recordingID: "rec_1", client: client)
        await model.load()
        XCTAssertEqual(model.documentMessage, "처리하지 못했습니다.")

        client.detail = detail(.partial, document: false)
        client.transcript = PreviewData.transcript
        model = RecordingViewModel(recordingID: "rec_1", client: client)
        await model.load()
        XCTAssertEqual(model.documentMessage, "노트를 만들지 못했습니다. 전사는 볼 수 있습니다.")
        XCTAssertNotNil(model.transcript)

        client.detail = detail(.ready, document: true)
        client.document = PreviewData.document
        model = RecordingViewModel(recordingID: "rec_1", client: client)
        await model.load()
        XCTAssertNil(model.documentMessage)
        XCTAssertEqual(model.phase, .loaded)
    }

    func testSeekFromSourceChip() async {
        let client = FakeClient()
        client.detail = detail(.ready, document: true)
        client.document = PreviewData.document
        client.transcript = PreviewData.transcript  // segment 4 starts at 725,000 ms
        let playback = FakePlayback()
        let model = RecordingViewModel(recordingID: "rec_1", client: client, playback: playback)
        await model.load()
        model.play(source: .transcript(startIdx: 4, endIdx: 4))
        XCTAssertEqual(playback.seeks, [725_000])
        XCTAssertEqual(playback.plays, 1)
        model.play(source: .pdfPage(assetID: "ast_pdf", page: 3))  // no PDF view yet: nothing
        model.play(fromMs: 9_000)  // a transcript line
        XCTAssertEqual(playback.seeks, [725_000, 9_000])
        XCTAssertEqual(playback.plays, 2)
    }

    // MARK: - Login

    func testLoginErrors() async {
        let cases: [(Error, String)] = [
            (APIError.unauthorized, "이메일 또는 비밀번호가 올바르지 않습니다."),
            (APIError.server(status: 429, code: "rate_limited", message: "too many"), "잠시 뒤 다시 시도해 주세요."),
            (APIError.transport("-1004"), "서버에 연결하지 못했습니다. 서버 주소와 네트워크를 확인해 주세요."),
        ]
        for (error, message) in cases {
            let client = FakeClient()
            client.signInError = error
            let model = LoginViewModel(client: client, onSignedIn: { _ in XCTFail("signed in") })
            model.email = "a@example.com"
            model.password = "pw"
            await model.submit()
            XCTAssertEqual(model.errorMessage, message)
            XCTAssertFalse(model.isWorking)
        }
    }

    func testLoginFallsBackToApiToken() async {
        let client = FakeClient()
        client.signInError = LoginError.nativeSignInUnavailable
        let model = LoginViewModel(client: client, onSignedIn: { _ in XCTFail("signed in") })
        model.email = "a@example.com"
        model.password = "pw"
        await model.submit()
        XCTAssertEqual(model.method, .apiToken)
        XCTAssertEqual(model.errorMessage, ScreenText.useApiToken)

        client.signInError = nil
        var signedIn: Me?
        let tokenModel = LoginViewModel(client: client, onSignedIn: { signedIn = $0 })
        tokenModel.method = .apiToken
        XCTAssertFalse(tokenModel.canSubmit)
        tokenModel.apiToken = "lct_x"
        await tokenModel.submit()
        XCTAssertEqual(signedIn, FixtureClient.me)
        XCTAssertEqual(tokenModel.apiToken, "")
    }
}

@MainActor
final class CancellationTests: XCTestCase {
    func testCancelledRequestIsNotAConnectionFailure() async {
        let client = FakeClient()
        client.listError = APIError.transport(String(URLError.cancelled.rawValue))
        let model = LibraryViewModel(client: client)
        await model.load()
        XCTAssertNotEqual(model.phase, .failed(ScreenText.connectionFailed))
        XCTAssertTrue(ScreenText.isCancellation(CancellationError()))
        XCTAssertFalse(ScreenText.isCancellation(APIError.transport("-1009")))
    }
}
