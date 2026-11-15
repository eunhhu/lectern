import XCTest
@testable import LecternKit

/// LecternAPI over a stubbed URLSession (P6-A2 §6): decoding with the domain fixtures, the
/// credential headers, the refresh-once rule and the error mapping.
final class LecternAPITests: XCTestCase {
    let server = URL(string: "https://lectern.test")!

    static func fixture(_ name: String) -> Data {
        let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")!
        return try! Data(contentsOf: url)
    }

    static func ok(_ name: String) -> StubURLProtocol.Reply { .init(status: 200, body: fixture(name)) }
    static let unauthorized = StubURLProtocol.Reply(
        status: 401, body: Data(#"{"error":{"code":"unauthorized","message":"로그인이 필요합니다."}}"#.utf8)
    )

    static func tokenPair(access: String, refresh: String) -> StubURLProtocol.Reply {
        let user = try! JSONSerialization.jsonObject(with: fixture("me"))
        let body: [String: Any] = ["token_type": "Bearer", "access_token": access, "refresh_token": refresh, "expires_in": 3600, "user": user]
        return .init(status: 200, body: try! JSONSerialization.data(withJSONObject: body))
    }

    static func isTokenCall(_ request: URLRequest) -> Bool { request.url!.path.hasSuffix("/auth/native/token") }

    func apiWithToken(_ token: String = "v1-token") -> LecternAPI {
        LecternAPI(serverURL: server, auth: ApiTokenProvider(store: InMemoryTokenStore([TokenKey.apiToken: token])), session: StubURLProtocol.session())
    }

    /// A NativeTokenProvider holding `lct_at_old` / `lct_rt_old…`, and the API over it.
    func native(_ store: InMemoryTokenStore) -> LecternAPI {
        let session = StubURLProtocol.session()
        let provider = NativeTokenProvider(serverURL: server, store: store, session: session)
        return LecternAPI(serverURL: server, auth: provider, session: session)
    }

    func signedInStore() -> InMemoryTokenStore {
        InMemoryTokenStore([TokenKey.accessToken: "lct_at_old", TokenKey.refreshToken: "lct_rt_old_0123456789abcdef"])
    }

    // MARK: - Decoding

    func testListRecordingsDecodes() async throws {
        StubURLProtocol.reset { _ in Self.ok("recording-page") }
        let page = try await apiWithToken().recordings(workspaceID: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a01", folderID: nil, cursor: nil)
        XCTAssertEqual(page.items.count, 1)
        let first = try XCTUnwrap(page.items.first)
        XCTAssertEqual(first.id, "lec_4be2a1c9d0f3")
        XCTAssertEqual(first.title, "암호학 7주차: 블록 암호 운영 모드")
        XCTAssertEqual(first.status, .ready)
        XCTAssertEqual(first.durationMs, 4_980_000)
        XCTAssertEqual(first.excerpt, "스케줄링 정리")
        XCTAssertEqual(first.progress, 0.4)
        XCTAssertNil(page.nextCursor)
        let query = URLComponents(url: StubURLProtocol.requests[0].url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
        XCTAssertEqual(query.first { $0.name == "workspace_id" }?.value, "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a01")
    }

    func testRecordingDetailDecodes() async throws {
        StubURLProtocol.reset { _ in Self.ok("recording-detail") }
        let detail = try await apiWithToken().recording(id: "lec_4be2a1c9d0f3")
        XCTAssertEqual(detail.recording.id, "lec_4be2a1c9d0f3")
        XCTAssertEqual(detail.documentID, "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a08")
        XCTAssertEqual(detail.audioAssetID, "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a05")
        XCTAssertEqual(detail.speakers.map(\.label), ["S1"])
        XCTAssertNil(detail.failureMessage)
        XCTAssertEqual(StubURLProtocol.requests[0].url!.path, "/api/v2/recordings/lec_4be2a1c9d0f3")
    }

    func testTranscriptDecodes() async throws {
        StubURLProtocol.reset { _ in Self.ok("transcript") }
        let transcript = try await apiWithToken().transcript(recordingID: "lec_4be2a1c9d0f3")
        XCTAssertEqual(transcript.segments.count, 1)
        let first = try XCTUnwrap(transcript.segments.first)
        XCTAssertEqual(first.startMs, 843_000)
        XCTAssertEqual(first.endMs, 851_500)
        XCTAssertEqual(transcript.speaker(of: first)?.name, "김교수")
        XCTAssertEqual(transcript.gaps.map(\.kind), ["break", "missing_transcript"])
    }

    func testDocumentDecodesKnownBlocks() async throws {
        StubURLProtocol.reset { _ in Self.ok("document") }
        let document = try await apiWithToken().document(id: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a08")
        XCTAssertEqual(document.version, 2)
        XCTAssertEqual(document.sections.map(\.key), ["summary", "topics"])
        var kinds: [String: Int] = [:]
        for block in document.sections.flatMap(\.blocks) {
            let kind: String
            switch block {
            case .paragraph: kind = "paragraph"
            case .list: kind = "list"
            case .quote: kind = "quote"
            case .term: kind = "term"
            case .formula: kind = "formula"
            case .callout: kind = "callout"
            case .gap: kind = "gap"
            case .unknown: kind = "unknown"
            }
            kinds[kind, default: 0] += 1
        }
        XCTAssertEqual(kinds, ["paragraph": 1, "list": 1, "quote": 1, "term": 1, "formula": 1, "callout": 1, "gap": 1, "unknown": 1])
        guard case let .paragraph(id, _, text, sources) = document.sections[0].blocks[0] else { return XCTFail("first block") }
        XCTAssertEqual(id, "b1")
        XCTAssertEqual(text, "ECB는 같은 평문 블록을 같은 암호문으로 바꾼다.")
        // The source of an unknown kind is dropped; the known one stays.
        XCTAssertEqual(sources, [.transcript(startIdx: 12, endIdx: 14)])
        guard case let .list(_, _, numbered, items, _) = document.sections[0].blocks[1] else { return XCTFail("list") }
        XCTAssertFalse(numbered)
        XCTAssertEqual(items.last?.sources, [.pdfPage(assetID: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a06", page: 3)])
    }

    func testUnknownBlockIsIgnored() async throws {
        StubURLProtocol.reset { _ in Self.ok("document") }
        let document = try await apiWithToken().document(id: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a08")
        XCTAssertEqual(document.sections[1].blocks.last, .unknown(type: "future_block"))
        XCTAssertEqual(document.sections[1].blocks.last?.id, "")
    }

    // MARK: - Credentials

    func testApiTokenHeader() async throws {
        StubURLProtocol.reset { _ in Self.ok("me") }
        let me = try await apiWithToken("v1-token-123").me()
        XCTAssertEqual(me.displayName, "학생")
        let request = StubURLProtocol.requests[0]
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Lectern-Token"), "v1-token-123")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    }

    func testBearerHeader() async throws {
        StubURLProtocol.reset { _ in Self.ok("me") }
        _ = try await native(signedInStore()).me()
        XCTAssertEqual(StubURLProtocol.requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer lct_at_old")
    }

    func testRefreshOnceThenRetry() async throws {
        StubURLProtocol.reset { request in
            if Self.isTokenCall(request) { return Self.tokenPair(access: "lct_at_new", refresh: "lct_rt_new_0123456789abcdef") }
            return request.value(forHTTPHeaderField: "Authorization") == "Bearer lct_at_new" ? Self.ok("me") : Self.unauthorized
        }
        let me = try await native(signedInStore()).me()
        XCTAssertEqual(me.email, "student@example.com")
        XCTAssertEqual(StubURLProtocol.requests.map(\.url!.path), ["/api/v2/me", "/api/v2/auth/native/token", "/api/v2/me"])
    }

    func testConcurrent401ShareOneRefresh() async throws {
        StubURLProtocol.reset { request in
            if Self.isTokenCall(request) {
                Thread.sleep(forTimeInterval: 0.05)  // keep the refresh in flight while the others fail
                return Self.tokenPair(access: "lct_at_new", refresh: "lct_rt_new_0123456789abcdef")
            }
            return request.value(forHTTPHeaderField: "Authorization") == "Bearer lct_at_new" ? Self.ok("me") : Self.unauthorized
        }
        let api = native(signedInStore())
        try await withThrowingTaskGroup(of: Me.self) { group in
            for _ in 0..<5 { group.addTask { try await api.me() } }
            var count = 0
            for try await _ in group { count += 1 }
            XCTAssertEqual(count, 5)
        }
        XCTAssertEqual(StubURLProtocol.requests.filter(Self.isTokenCall).count, 1)
    }

    func testAnotherProcessRotatedThePair() async throws {
        // The app (a) and the share extension (b) share one store. A refreshes first; B then gets
        // a 401 with the old access token and takes the stored pair instead of refreshing again.
        StubURLProtocol.reset { request in
            if Self.isTokenCall(request) { return Self.tokenPair(access: "lct_at_new", refresh: "lct_rt_new_0123456789abcdef") }
            return request.value(forHTTPHeaderField: "Authorization") == "Bearer lct_at_new" ? Self.ok("me") : Self.unauthorized
        }
        let store = signedInStore()
        let a = native(store)
        let b = native(store)
        _ = try await a.me()
        _ = try await b.me()
        XCTAssertEqual(StubURLProtocol.requests.filter(Self.isTokenCall).count, 1)
        XCTAssertEqual(StubURLProtocol.requests.last?.value(forHTTPHeaderField: "Authorization"), "Bearer lct_at_new")
    }

    func testRefreshRotatesStoredPair() async throws {
        StubURLProtocol.reset { request in
            if Self.isTokenCall(request) { return Self.tokenPair(access: "lct_at_new", refresh: "lct_rt_new_0123456789abcdef") }
            return request.value(forHTTPHeaderField: "Authorization") == "Bearer lct_at_new" ? Self.ok("me") : Self.unauthorized
        }
        let store = signedInStore()
        _ = try await native(store).me()
        XCTAssertEqual(store.read(TokenKey.accessToken), "lct_at_new")
        XCTAssertEqual(store.read(TokenKey.refreshToken), "lct_rt_new_0123456789abcdef")
    }

    func testRefreshFailureSignsOut() async throws {
        StubURLProtocol.reset { _ in Self.unauthorized }
        let store = signedInStore()
        do {
            _ = try await native(store).me()
            XCTFail("expected unauthorized")
        } catch let error as APIError {
            XCTAssertEqual(error, .unauthorized)
        }
        XCTAssertNil(store.read(TokenKey.accessToken))
        XCTAssertNil(store.read(TokenKey.refreshToken))
    }

    func testNoSecondRetry() async throws {
        StubURLProtocol.reset { request in
            Self.isTokenCall(request) ? Self.tokenPair(access: "lct_at_new", refresh: "lct_rt_new_0123456789abcdef") : Self.unauthorized
        }
        do {
            _ = try await native(signedInStore()).me()
            XCTFail("expected unauthorized")
        } catch let error as APIError {
            XCTAssertEqual(error, .unauthorized)
        }
        XCTAssertEqual(StubURLProtocol.requests.count, 3)
    }

    func testApiTokenIsNotRefreshed() async throws {
        StubURLProtocol.reset { _ in Self.unauthorized }
        do {
            _ = try await apiWithToken().me()
            XCTFail("expected unauthorized")
        } catch let error as APIError {
            XCTAssertEqual(error, .unauthorized)
        }
        XCTAssertEqual(StubURLProtocol.requests.count, 1)
    }

    func testSignInStoresThePair() async throws {
        StubURLProtocol.reset { _ in Self.tokenPair(access: "lct_at_first", refresh: "lct_rt_first_0123456789abcdef") }
        let store = InMemoryTokenStore()
        let provider = NativeTokenProvider(serverURL: server, store: store, session: StubURLProtocol.session(), platform: "macos")
        let me = try await provider.signIn(email: "student@example.com", password: "pw", deviceName: "MacBook")
        XCTAssertEqual(me.id, "usr_3b1f0c9e-6a52-4f6e-9d3a-0c8f2e7b1a44")
        XCTAssertEqual(store.read(TokenKey.refreshToken), "lct_rt_first_0123456789abcdef")
        let isSignedIn = await provider.isSignedIn
        XCTAssertTrue(isSignedIn)
    }

    // MARK: - Errors and URLs

    func testQuotaExceededCarriesTheMessage() async throws {
        StubURLProtocol.reset { _ in .init(status: 409, body: Self.fixture("error-quota")) }
        do {
            _ = try await apiWithToken().me()
            XCTFail("expected quota_exceeded")
        } catch let error as APIError {
            XCTAssertEqual(error, .quotaExceeded(message: "이번 달 녹음 시간을 다 썼습니다."))
        }
    }

    func testNotFoundAndServerErrors() async throws {
        StubURLProtocol.reset { _ in .init(status: 404, body: Self.fixture("error-not-found")) }
        do {
            _ = try await apiWithToken().recording(id: "x")
            XCTFail("expected not found")
        } catch let error as APIError {
            XCTAssertEqual(error, .notFound)
        }
        StubURLProtocol.reset { _ in .init(status: 503, body: Data("<html>".utf8), headers: ["Content-Type": "text/html"]) }
        do {
            _ = try await apiWithToken().me()
            XCTFail("expected a server error")
        } catch let error as APIError {
            XCTAssertEqual(error, .server(status: 503, code: nil, message: nil))
        }
    }

    func testServerURLIsUsed() async throws {
        StubURLProtocol.reset { _ in Self.ok("me") }
        let api = LecternAPI(
            serverURL: URL(string: "http://127.0.0.1:1")!,
            auth: ApiTokenProvider(store: InMemoryTokenStore([TokenKey.apiToken: "t"])),
            session: StubURLProtocol.session()
        )
        _ = try await api.me()
        let url = StubURLProtocol.requests[0].url!
        XCTAssertEqual(url.host, "127.0.0.1")
        XCTAssertEqual(url.port, 1)
        XCTAssertTrue(url.path.hasPrefix("/api/v2/"), url.path)
    }

    func testAssetContentRequestIsAuthorized() async throws {
        let request = try await apiWithToken("v1-token-9").assetContentRequest(assetID: "0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a05")
        XCTAssertEqual(request.url?.absoluteString, "https://lectern.test/api/v2/assets/0192a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a05/content")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Lectern-Token"), "v1-token-9")
    }
}
