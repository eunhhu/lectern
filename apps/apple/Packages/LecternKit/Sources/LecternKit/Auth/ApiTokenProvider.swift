import Foundation

/// The v1 API token (`X-Lectern-Token`), for servers without native tokens and for the token a
/// user pastes. It cannot be refreshed: a 401 means signing in again.
public actor ApiTokenProvider: AuthProvider {
    public static let header = "X-Lectern-Token"
    private let store: TokenStore

    public init(store: TokenStore) {
        self.store = store
    }

    /// Saves the token (Keychain in the apps).
    @discardableResult
    public func setToken(_ token: String) -> Bool {
        store.write(token, for: TokenKey.apiToken)
    }

    public var isSignedIn: Bool { store.read(TokenKey.apiToken) != nil }

    public func authorize(_ request: inout URLRequest) async throws {
        if let token = store.read(TokenKey.apiToken) {
            request.setValue(token, forHTTPHeaderField: Self.header)
        }
    }

    public func refreshAfterUnauthorized() async throws -> Bool { false }

    public func signOut() async {
        store.delete(TokenKey.apiToken)
    }
}
