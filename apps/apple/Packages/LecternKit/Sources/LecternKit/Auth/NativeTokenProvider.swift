import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

/// The native token pair of D-P5-4: `Authorization: Bearer <access>`, and a single-use refresh
/// token that each refresh rotates.
///
/// - Concurrent 401s share one refresh (the task in flight).
/// - The new pair is written to the store before it is used: losing a rotated refresh token
///   would sign the user out at the next launch.
/// - A refused refresh (401) forgets the pair; the user signs in again.
/// - Another process (widget, share extension) may rotate the pair: a refresh first looks at the
///   store and takes a newer pair from there.
public actor NativeTokenProvider: AuthProvider {
    private let store: TokenStore
    private let client: Client
    private let platform: String
    private var access: String?
    private var refresh: String?
    private var refreshing: Task<Bool, Error>?

    /// `platform` is what the server shows in the device list: `ios` or `macos`.
    public init(serverURL: URL, store: TokenStore, session: URLSession = .shared, platform: String = "ios") {
        self.store = store
        self.platform = platform
        // No AuthMiddleware here: the token endpoint is public, and a 401 from it must not refresh.
        client = Client(
            serverURL: LecternAPI.apiBase(serverURL),
            configuration: LecternAPI.configuration,
            transport: URLSessionTransport(configuration: .init(session: session)),
            middlewares: [ErrorMiddleware()]
        )
        access = store.read(TokenKey.accessToken)
        refresh = store.read(TokenKey.refreshToken)
    }

    public var isSignedIn: Bool { refresh != nil }

    /// Signs in with email and password; stores the pair.
    @discardableResult
    public func signIn(email: String, password: String, deviceName: String?) async throws -> Me {
        let body = Components.Schemas.NativeTokenRequest.password(
            .init(grant_type: .password, email: email, password: password, device_name: deviceName, platform: platform)
        )
        do {
            let pair = try await client.issueNativeToken(.init(body: .json(body))).ok.body.json
            save(pair)
            return Me(pair.user)
        } catch {
            throw LecternAPI.apiError(error)
        }
    }

    public func authorize(_ request: inout URLRequest) async throws {
        if let access {
            request.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
        }
    }

    public func refreshAfterUnauthorized() async throws -> Bool {
        if let refreshing { return try await refreshing.value }
        let task = Task { try await self.rotate() }
        refreshing = task
        defer { refreshing = nil }
        return try await task.value
    }

    public func signOut() async {
        if let refresh {
            // Best effort: the server forgets the family; the local pair goes either way.
            _ = try? await client.revokeNativeToken(.init(body: .json(.init(refresh_token: refresh))))
        }
        clear()
    }

    private func rotate() async throws -> Bool {
        // The app, its widgets and the share extension share one Keychain item. When another
        // process has rotated the pair, use its pair: sending our spent refresh token would make
        // the server revoke the whole family (every process signed out).
        let stored = (access: store.read(TokenKey.accessToken), refresh: store.read(TokenKey.refreshToken))
        if let storedRefresh = stored.refresh, storedRefresh != refresh {
            refresh = storedRefresh
            access = stored.access
            return true
        }
        guard let refresh else { return false }
        let body = Components.Schemas.NativeTokenRequest.refresh_token(.init(grant_type: .refresh_token, refresh_token: refresh))
        do {
            let pair = try await client.issueNativeToken(.init(body: .json(body))).ok.body.json
            save(pair)
            return true
        } catch {
            switch LecternAPI.apiError(error) {
            case .unauthorized:
                clear()
                return false
            case let other:
                throw other  // offline or a server error: keep the pair and try again later
            }
        }
    }

    private func save(_ pair: Components.Schemas.NativeTokenResponse) {
        store.write(pair.refresh_token, for: TokenKey.refreshToken)
        store.write(pair.access_token, for: TokenKey.accessToken)
        refresh = pair.refresh_token
        access = pair.access_token
    }

    private func clear() {
        store.delete(TokenKey.accessToken)
        store.delete(TokenKey.refreshToken)
        access = nil
        refresh = nil
    }
}
