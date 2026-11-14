import Foundation

/// Answers from memory: one workspace, three folders, eight recordings (five ready, one
/// processing, one with only a transcript, one failed). Every ready recording has the
/// `FixtureData` document and transcript. Signed in from the start. No real names.
public final class FixtureClient: LecternClient {
    public static let me = Me(
        id: "usr_fixture", email: "demo@example.com", displayName: "체험 사용자", timezone: "Asia/Seoul",
        systemRole: "member", personalWorkspaceID: "ws_fixture"
    )
    public static let workspace = WorkspaceSummary(id: "ws_fixture", name: "내 워크스페이스", kind: "personal", role: "owner")
    public static let folders: [Folder] = [
        Folder(id: "fld_algo", workspaceID: "ws_fixture", parentID: nil, name: "알고리즘", sortKey: "a"),
        Folder(id: "fld_os", workspaceID: "ws_fixture", parentID: nil, name: "운영체제", sortKey: "b"),
        Folder(id: "fld_meet", workspaceID: "ws_fixture", parentID: nil, name: "회의", sortKey: "c"),
    ]

    public static let recordings: [RecordingSummary] = {
        let base = Date(timeIntervalSince1970: 1_792_387_800)  // 2026-10-19
        let rows: [(String, String?, String, RecordingStatus, Int?)] = [
            ("rec_fx1", "fld_algo", "정렬 알고리즘 3주차", .ready, 4_380_000),
            ("rec_fx2", "fld_algo", "그래프 탐색", .ready, 4_920_000),
            ("rec_fx3", "fld_os", "프로세스와 스레드", .ready, 3_600_000),
            ("rec_fx4", "fld_os", "가상 메모리", .processing, 5_100_000),
            ("rec_fx5", "fld_meet", "주간 진행 회의", .ready, 1_800_000),
            ("rec_fx6", "fld_meet", "기획 검토", .partial, 2_700_000),
            ("rec_fx7", nil, "음성 메모", .failed, 95_000),
            ("rec_fx8", "fld_algo", "동적 계획법", .ready, 4_500_000),
        ]
        return rows.enumerated().map { index, row in
            let at = base.addingTimeInterval(-Double(index) * 86_400)
            return RecordingSummary(
                id: row.0, workspaceID: "ws_fixture", folderID: row.1, title: row.2, status: row.3, durationMs: row.4,
                recordedAt: at, createdAt: at, updatedAt: at, excerpt: nil, progress: row.3 == .processing ? 0.4 : nil
            )
        }
    }()

    public init() {}

    public func me() async throws -> Me { Self.me }
    public func workspaces() async throws -> [WorkspaceSummary] { [Self.workspace] }
    public func folders(workspaceID: String) async throws -> [Folder] { Self.folders }

    public func recordings(workspaceID: String, folderID: String?, cursor: String?) async throws -> Page<RecordingSummary> {
        Page(items: Self.recordings.filter { folderID == nil || $0.folderID == folderID }, nextCursor: nil)
    }

    public func recording(id: String) async throws -> RecordingDetail {
        guard let summary = Self.recordings.first(where: { $0.id == id }) else { throw APIError.notFound }
        let ready = summary.status == .ready
        return RecordingDetail(
            recording: summary,
            assets: [],
            documents: ready ? [DocumentSummary(id: "doc_\(id)", templateID: "lecture", currentVersion: 1, updatedAt: summary.updatedAt)] : [],
            speakers: FixtureData.transcript.speakers,
            failureMessage: summary.status == .failed ? "오디오를 읽지 못했습니다." : nil
        )
    }

    public func transcript(recordingID: String) async throws -> Transcript {
        guard let summary = Self.recordings.first(where: { $0.id == recordingID }), summary.status == .ready || summary.status == .partial else {
            throw APIError.notFound
        }
        return FixtureData.transcript
    }

    public func document(id: String) async throws -> Document {
        guard id.hasPrefix("doc_rec_fx") else { throw APIError.notFound }
        return FixtureData.document
    }

    /// Fixtures have no audio.
    public func audioURL(for recording: RecordingDetail) async throws -> URL? { nil }

    public func signIn(email: String, password: String) async throws -> Me { Self.me }
    public func signIn(apiToken: String) async throws -> Me { Self.me }
    public func signOut() async {}
    public func isSignedIn() async -> Bool { true }
}
