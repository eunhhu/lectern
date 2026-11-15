import Foundation

/// What the app's screens need from the server. `LiveClient` asks the server; `FixtureClient`
/// answers from memory (no server: UI tests, screenshots, trying the app).
public protocol LecternClient: Sendable {
    func me() async throws -> Me
    func workspaces() async throws -> [WorkspaceSummary]
    func folders(workspaceID: String) async throws -> [Folder]
    func recordings(workspaceID: String, folderID: String?, cursor: String?) async throws -> Page<RecordingSummary>
    func recording(id: String) async throws -> RecordingDetail
    func transcript(recordingID: String) async throws -> Transcript
    func document(id: String) async throws -> Document
    /// A URL AVPlayer can stream for the recording's audio (it carries the credential); nil when
    /// the recording has no audio.
    func audioURL(for recording: RecordingDetail) async throws -> URL?
    /// Email and password (native tokens). Throws `LoginError.nativeSignInUnavailable` when the
    /// server has no native sign-in yet (501 or 404 on its route).
    func signIn(email: String, password: String) async throws -> Me
    /// An API token the user pasted; kept only if `me()` accepts it.
    func signIn(apiToken: String) async throws -> Me
    func signOut() async
    func isSignedIn() async -> Bool
    /// The calendar events found in a recording.
    func events(recordingID: String) async throws -> [EventCandidateModel]
}

extension LecternClient {
    /// None (fixtures and fakes).
    public func events(recordingID: String) async throws -> [EventCandidateModel] { [] }
}

public enum LoginError: Error, Equatable, Sendable {
    /// The server predates native tokens: sign in with an API token instead.
    case nativeSignInUnavailable
}

/// Sends whichever credential is stored: a pasted API token, else the native pair. One is
/// cleared when the other is set, so there is never a choice to make.
actor CredentialSwitch: AuthProvider {
    let native: NativeTokenProvider
    let apiToken: ApiTokenProvider

    init(native: NativeTokenProvider, apiToken: ApiTokenProvider) {
        self.native = native
        self.apiToken = apiToken
    }

    func authorize(_ request: inout URLRequest) async throws {
        if await apiToken.isSignedIn {
            try await apiToken.authorize(&request)
        } else {
            try await native.authorize(&request)
        }
    }

    func refreshAfterUnauthorized() async throws -> Bool {
        if await apiToken.isSignedIn { return false }
        return try await native.refreshAfterUnauthorized()
    }

    func signOut() async {
        await apiToken.signOut()
        await native.signOut()
    }

    var isSignedIn: Bool {
        get async {
            let token = await apiToken.isSignedIn
            let pair = await native.isSignedIn
            return token || pair
        }
    }
}

/// The real server through `LecternAPI`.
public final class LiveClient: LecternClient {
    public let serverURL: URL
    public let api: LecternAPI
    private let auth: CredentialSwitch
    private let deviceName: String?

    /// `platform`: `ios` or `macos` (the server's device list). `deviceName`: shown there too.
    public init(serverURL: URL, store: TokenStore, session: URLSession = .shared, platform: String, deviceName: String?) {
        self.serverURL = serverURL
        self.deviceName = deviceName
        auth = CredentialSwitch(
            native: NativeTokenProvider(serverURL: serverURL, store: store, session: session, platform: platform),
            apiToken: ApiTokenProvider(store: store)
        )
        api = LecternAPI(serverURL: serverURL, auth: auth, session: session)
    }

    public func me() async throws -> Me { try await api.me() }
    public func workspaces() async throws -> [WorkspaceSummary] { try await api.workspaces() }
    public func folders(workspaceID: String) async throws -> [Folder] { try await api.folders(workspaceID: workspaceID) }

    public func recordings(workspaceID: String, folderID: String?, cursor: String?) async throws -> Page<RecordingSummary> {
        try await api.recordings(workspaceID: workspaceID, folderID: folderID, cursor: cursor)
    }

    public func recording(id: String) async throws -> RecordingDetail { try await api.recording(id: id) }
    public func transcript(recordingID: String) async throws -> Transcript { try await api.transcript(recordingID: recordingID) }
    public func document(id: String) async throws -> Document { try await api.document(id: id) }

    public func audioURL(for recording: RecordingDetail) async throws -> URL? {
        guard let assetID = recording.audioAssetID else { return nil }
        return try await api.assetContentURL(assetID: assetID)
    }

    public func signIn(email: String, password: String) async throws -> Me {
        await auth.apiToken.signOut()
        do {
            return try await auth.native.signIn(email: email, password: password, deviceName: deviceName)
        } catch let error as APIError {
            switch error {
            case .notFound, .server(status: 501, _, _): throw LoginError.nativeSignInUnavailable
            default: throw error
            }
        }
    }

    public func signIn(apiToken token: String) async throws -> Me {
        await auth.native.signOut()
        await auth.apiToken.setToken(token.trimmingCharacters(in: .whitespacesAndNewlines))
        do {
            return try await api.me()
        } catch {
            await auth.apiToken.signOut()
            throw error
        }
    }

    public func signOut() async { await auth.signOut() }
    public func isSignedIn() async -> Bool { await auth.isSignedIn }
    public func events(recordingID: String) async throws -> [EventCandidateModel] { try await api.events(recordingID: recordingID) }

    /// A v1 API token carried over from the old macOS app (`LegacyMacToken`), saved without asking
    /// the server: it may be offline at first launch. A token the server refuses later signs out
    /// like any other 401.
    public func adoptAPIToken(_ token: String) async {
        await auth.apiToken.setToken(token.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}
