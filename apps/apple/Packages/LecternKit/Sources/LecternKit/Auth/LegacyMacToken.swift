import Foundation
import Security

/// Carrying the sign-in over from the old menu bar app (`apps/macos`). After P6-A0 it keeps a v1
/// API token in the Keychain item (service `com.qucord.lectern.macos`, account `auth_token`).
/// The new app adopts it once, when its own store has no credential, and leaves the old item in
/// place so the old app still works.
public enum LegacyPlan: Equatable, Sendable {
    case none
    case adopt(String)
}

public func legacyMigrationPlan(newStoreHasCredential: Bool, legacyToken: String?) -> LegacyPlan {
    guard !newStoreHasCredential, let token = legacyToken?.trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
        return .none
    }
    return .adopt(token)
}

public enum LegacyMacToken {
    public static let service = "com.qucord.lectern.macos"
    public static let account = "auth_token"

    /// The old app's token, if this app may read its item (same team and bundle id; otherwise
    /// the user signs in once more).
    public static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
