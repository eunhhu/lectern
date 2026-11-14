import Foundation
import Security

/// Generic-password Keychain items of service `com.qucord.lectern`, one per key, readable on this
/// device after its first unlock. The apps pass their shared access group
/// (`$(AppIdentifierPrefix)com.qucord.lectern`) so the widgets and extensions read the same items.
public final class KeychainTokenStore: TokenStore, Sendable {
    public static let service = "com.qucord.lectern"
    private let accessGroup: String?

    public init(accessGroup: String?) {
        self.accessGroup = accessGroup
    }

    private func query(_ key: String) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: key,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }

    public func read(_ key: String) -> String? {
        var query = query(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    public func write(_ value: String, for key: String) -> Bool {
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updated = SecItemUpdate(query(key) as CFDictionary, attributes as CFDictionary)
        if updated == errSecSuccess { return true }
        guard updated == errSecItemNotFound else { return false }
        let add = query(key).merging(attributes) { _, new in new }
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    public func delete(_ key: String) {
        _ = SecItemDelete(query(key) as CFDictionary)  // errSecItemNotFound: nothing to delete
    }
}
