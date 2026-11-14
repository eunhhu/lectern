import Foundation

/// Adds the signed-in user's credential to API requests (D-P6-7). Two kinds exist: the v1 API
/// token (`ApiTokenProvider`) and the native token pair (`NativeTokenProvider`, D-P5-4).
public protocol AuthProvider: Sendable {
    /// Adds the credential header (nothing when signed out).
    func authorize(_ request: inout URLRequest) async throws
    /// Called after a 401. True when the request is worth sending again (a new access token).
    func refreshAfterUnauthorized() async throws -> Bool
    /// Forgets the stored credentials.
    func signOut() async
}
