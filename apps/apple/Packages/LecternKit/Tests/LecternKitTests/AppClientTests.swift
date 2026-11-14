import XCTest
@testable import LecternKit

/// AppEnvironment, FixtureClient and LiveClient (P6-A6).
final class AppClientTests: XCTestCase {
    let server = URL(string: "https://lectern.test")!

    // MARK: - AppEnvironment

    func testServerURLPrefersTheUsersSetting() {
        let saved = AppEnvironment(arguments: [], environment: [:], savedServerURL: "https://mine.example/", infoPlistServerURL: "http://localhost:18775")
        XCTAssertEqual(saved.serverURL.absoluteString, "https://mine.example")
        let build = AppEnvironment(arguments: [], environment: [:], savedServerURL: nil, infoPlistServerURL: "http://localhost:18775")
        XCTAssertEqual(build.serverURL.absoluteString, "http://localhost:18775")
        let broken = AppEnvironment(arguments: [], environment: [:], savedServerURL: "not a url", infoPlistServerURL: "$(LECTERN_SERVER_URL)")
        XCTAssertEqual(broken.serverURL, AppEnvironment.fallbackServerURL)
    }

    func testFixtureModeFromArgumentOrEnvironment() {
        XCTAssertTrue(AppEnvironment(arguments: ["app", "-LECTERN_FIXTURE", "1"], environment: [:], savedServerURL: nil, infoPlistServerURL: nil).isFixture)
        XCTAssertTrue(AppEnvironment(arguments: [], environment: ["LECTERN_FIXTURE": "1"], savedServerURL: nil, infoPlistServerURL: nil).isFixture)
        XCTAssertFalse(AppEnvironment(arguments: ["app", "-LECTERN_FIXTURE", "0"], environment: [:], savedServerURL: nil, infoPlistServerURL: nil).isFixture)
        XCTAssertFalse(AppEnvironment(arguments: ["app", "-LECTERN_FIXTURE"], environment: [:], savedServerURL: nil, infoPlistServerURL: nil).isFixture)
    }

    func testValidServerURL() {
        XCTAssertEqual(AppEnvironment.validServerURL(" https://a.example/// ")?.absoluteString, "https://a.example")
        XCTAssertNil(AppEnvironment.validServerURL("ftp://a.example"))
        XCTAssertNil(AppEnvironment.validServerURL("a.example"))
        XCTAssertNil(AppEnvironment.validServerURL("https://"))
    }

    // MARK: - FixtureClient

    func testFixtureLibrary() async throws {
        let client = FixtureClient()
        let all = try await client.recordings(workspaceID: "ws_fixture", folderID: nil, cursor: nil).items
        XCTAssertEqual(all.count, 8)
        XCTAssertEqual(all.filter { $0.status == .ready }.count, 5)
        XCTAssertEqual(all.filter { $0.status == .processing }.count, 1)
        XCTAssertEqual(all.filter { $0.status == .partial }.count, 1)
        XCTAssertEqual(all.filter { $0.status == .failed }.count, 1)
        let folders = try await client.folders(workspaceID: "ws_fixture")
        XCTAssertEqual(folders.count, 3)
        let algo = try await client.recordings(workspaceID: "ws_fixture", folderID: "fld_algo", cursor: nil).items
        XCTAssertTrue(algo.allSatisfy { $0.folderID == "fld_algo" })
        let isSignedIn = await client.isSignedIn()
        XCTAssertTrue(isSignedIn)
    }

    func testFixtureRecordingsMatchTheirStatus() async throws {
        let client = FixtureClient()
        let ready = try await client.recording(id: "rec_fx1")
        XCTAssertNotNil(ready.documentID)
        _ = try await client.document(id: ready.documentID!)
        _ = try await client.transcript(recordingID: "rec_fx1")
        let partial = try await client.recording(id: "rec_fx6")
        XCTAssertNil(partial.documentID)
        _ = try await client.transcript(recordingID: "rec_fx6")
        do {
            _ = try await client.transcript(recordingID: "rec_fx4")
            XCTFail("a processing recording has no transcript")
        } catch {
            XCTAssertEqual(error as? APIError, .notFound)
        }
        let audio = try await client.audioURL(for: ready)
        XCTAssertNil(audio)
    }

    // MARK: - LiveClient

    private func live(_ store: InMemoryTokenStore = InMemoryTokenStore()) -> LiveClient {
        LiveClient(serverURL: server, store: store, session: StubURLProtocol.session(), platform: "ios", deviceName: "테스트 기기")
    }

    func testNativeSignInUnavailableOn501And404() async {
        for status in [501, 404] {
            StubURLProtocol.reset { _ in .init(status: status, body: Data(#"{"error":{"code":"not_implemented","message":"x"}}"#.utf8)) }
            do {
                _ = try await live().signIn(email: "a@example.com", password: "pw")
                XCTFail("status \(status)")
            } catch {
                XCTAssertEqual(error as? LoginError, .nativeSignInUnavailable, "status \(status)")
            }
        }
    }

    func testNativeSignInWrongPasswordStaysUnauthorized() async {
        StubURLProtocol.reset { _ in LecternAPITests.unauthorized }
        do {
            _ = try await live().signIn(email: "a@example.com", password: "pw")
            XCTFail("401")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized)
        }
    }

    func testApiTokenSignInIsCheckedAndForgottenWhenRejected() async throws {
        let store = InMemoryTokenStore()
        StubURLProtocol.reset { _ in LecternAPITests.unauthorized }
        do {
            _ = try await live(store).signIn(apiToken: " bad ")
            XCTFail("rejected token")
        } catch {}
        XCTAssertNil(store.read(TokenKey.apiToken))

        StubURLProtocol.reset { _ in LecternAPITests.ok("me") }
        let client = live(store)
        _ = try await client.signIn(apiToken: " lct_good ")
        XCTAssertEqual(store.read(TokenKey.apiToken), "lct_good")
        XCTAssertEqual(StubURLProtocol.requests.last?.value(forHTTPHeaderField: ApiTokenProvider.header), "lct_good")
        let isSignedIn = await client.isSignedIn()
        XCTAssertTrue(isSignedIn)
    }

    func testAudioURLCarriesTheCredential() async throws {
        StubURLProtocol.reset { request in
            request.url!.path.hasSuffix("/me") ? LecternAPITests.ok("me") : LecternAPITests.ok("recording-detail")
        }
        let client = live(InMemoryTokenStore([TokenKey.accessToken: "lct_at_now", TokenKey.refreshToken: "lct_rt_0123456789abcdef"]))
        let detail = try await client.recording(id: "rec_1")
        let url = try await client.audioURL(for: detail)
        let components = URLComponents(url: try XCTUnwrap(url), resolvingAgainstBaseURL: false)!
        XCTAssertTrue(components.path.hasPrefix("/api/v2/assets/"))
        XCTAssertTrue(components.path.hasSuffix("/content"))
        XCTAssertEqual(components.queryItems, [URLQueryItem(name: "token", value: "lct_at_now")])
    }
}
