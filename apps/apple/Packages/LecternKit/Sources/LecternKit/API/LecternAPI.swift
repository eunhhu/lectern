import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

/// The one place the Apple apps call API v2 (D-P6-7). The client underneath is generated from
/// packages/domain/openapi.json at build time and stays internal; apps see these methods and
/// the value types in Models/.
public struct LecternAPI: Sendable {
    public let serverURL: URL
    let auth: AuthProvider
    let client: Client
    /// For the calls read without the generated client (`events`).
    let session: URLSession

    public init(serverURL: URL, auth: AuthProvider, session: URLSession = .shared) {
        self.serverURL = serverURL
        self.auth = auth
        self.session = session
        // Order: errors outermost (they see the answer after the auth retry), auth innermost.
        client = Client(
            serverURL: Self.apiBase(serverURL),
            configuration: Self.configuration,
            transport: URLSessionTransport(configuration: .init(session: session)),
            middlewares: [ErrorMiddleware(), OpenUnionMiddleware(), AuthMiddleware(auth: auth)]
        )
    }

    // MARK: - Calls

    public func me() async throws -> Me {
        try await run { Me(try await client.getMe(.init()).ok.body.json) }
    }

    /// Every workspace the user belongs to.
    public func workspaces() async throws -> [WorkspaceSummary] {
        try await run {
            try await allPages { cursor in
                let page = try await client.listWorkspaces(.init(query: .init(cursor: cursor))).ok.body.json
                return (page.items.map(WorkspaceSummary.init), page.next_cursor)
            }
        }
    }

    /// Every folder of a workspace.
    public func folders(workspaceID: String) async throws -> [Folder] {
        try await run {
            try await allPages { cursor in
                let page = try await client.listFolders(.init(query: .init(cursor: cursor, workspace_id: workspaceID))).ok.body.json
                return (page.items.map(Folder.init), page.next_cursor)
            }
        }
    }

    /// One page of a workspace's recordings, newest first; `folderID` nil means every folder.
    public func recordings(workspaceID: String, folderID: String?, cursor: String?) async throws -> Page<RecordingSummary> {
        try await run {
            let page = try await client.listRecordings(
                .init(query: .init(cursor: cursor, workspace_id: workspaceID, folder_id: folderID))
            ).ok.body.json
            return Page(items: page.items.map(RecordingSummary.init), nextCursor: page.next_cursor)
        }
    }

    public func recording(id: String) async throws -> RecordingDetail {
        try await run { RecordingDetail(try await client.getRecording(.init(path: .init(recording_id: id))).ok.body.json) }
    }

    public func transcript(recordingID: String) async throws -> Transcript {
        try await run { Transcript(try await client.getTranscript(.init(path: .init(recording_id: recordingID))).ok.body.json) }
    }

    public func document(id: String) async throws -> Document {
        try await run { Document(try await client.getDocument(.init(path: .init(document_id: id))).ok.body.json) }
    }

    /// An authorised GET of an asset's bytes, for AVPlayer and downloads.
    public func assetContentRequest(assetID: String) async throws -> URLRequest {
        let url = Self.apiBase(serverURL).appendingPathComponent("assets").appendingPathComponent(assetID).appendingPathComponent("content")
        var request = URLRequest(url: url)
        try await auth.authorize(&request)
        return request
    }

    /// The asset's bytes as a URL that carries the credential in `?token=` (the server accepts
    /// it, and AVPlayer cannot add headers). Calls `me()` first so an expired access token is
    /// refreshed before it goes into the URL. A native access token lasts an hour: a player that
    /// gets 401 later asks for a new URL.
    public func assetContentURL(assetID: String) async throws -> URL {
        _ = try await me()
        let request = try await assetContentRequest(assetID: assetID)
        guard let url = request.url else { throw APIError.decoding("asset url") }
        let credential = request.value(forHTTPHeaderField: "Authorization").map { String($0.dropFirst("Bearer ".count)) }
            ?? request.value(forHTTPHeaderField: ApiTokenProvider.header)
        guard let credential, var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        components.queryItems = [URLQueryItem(name: "token", value: credential)]
        return components.url ?? url
    }

    // MARK: - Plumbing

    /// `<server>/api/v2`: the generated paths start after it.
    static func apiBase(_ serverURL: URL) -> URL {
        serverURL.appendingPathComponent("api").appendingPathComponent("v2")
    }

    static let configuration = Configuration(dateTranscoder: LenientISO8601DateTranscoder())

    /// Every error a call can throw, as an APIError.
    static func apiError(_ error: any Error) -> APIError {
        switch error {
        case let api as APIError: return api
        case let client as ClientError: return apiError(client.underlyingError)
        case let decoding as DecodingError: return .decoding(String(describing: decoding))
        case let url as URLError: return .transport("\(url.code.rawValue)")
        default: return .transport(String(describing: type(of: error)))
        }
    }

    /// Runs generated-client calls with every error turned into an APIError.
    func run<T>(_ body: () async throws -> T) async throws -> T {
        do {
            return try await body()
        } catch {
            throw Self.apiError(error)
        }
    }

    /// Follows `next_cursor` (at most 50 pages).
    private func allPages<T>(_ page: (String?) async throws -> ([T], String?)) async throws -> [T] {
        var items: [T] = []
        var cursor: String?
        for _ in 0..<50 {
            let (more, next) = try await page(cursor)
            items += more
            guard let next else { break }
            cursor = next
        }
        return items
    }
}

/// The server writes `2026-10-19T05:30:00.000Z`; older rows may lack the fraction.
struct LenientISO8601DateTranscoder: DateTranscoder {
    func encode(_ date: Date) throws -> String {
        date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
    }

    func decode(_ string: String) throws -> Date {
        if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(string) { return date }
        return try Date.ISO8601FormatStyle().parse(string)
    }
}
