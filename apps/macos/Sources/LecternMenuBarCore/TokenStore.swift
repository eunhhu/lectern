import Foundation
import Security

/// Where the menu bar app keeps its API token.
public protocol TokenStore {
    func read() -> String?
    @discardableResult func write(_ token: String) -> Bool
    func delete()
}

/// The parts of UserDefaults the migration needs. UserDefaults conforms as is.
public protocol LegacyDefaults {
    func string(forKey defaultName: String) -> String?
    func removeObject(forKey defaultName: String)
}

extension UserDefaults: LegacyDefaults {}

/// A generic-password Keychain item, readable only on this Mac after its first unlock.
public final class KeychainTokenStore: TokenStore {
    private let service: String
    private let account: String

    public init(service: String = "com.qucord.lectern.macos", account: String = "auth_token") {
        self.service = service
        self.account = account
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func read() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    public func write(_ token: String) -> Bool {
        let data = Data(token.utf8)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updated = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if updated == errSecSuccess { return true }
        guard updated == errSecItemNotFound else { return false }
        var add = baseQuery
        add.merge(attributes) { _, new in new }
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    public func delete() {
        // errSecItemNotFound means there was nothing to delete: that is fine.
        _ = SecItemDelete(baseQuery as CFDictionary)
    }
}

/// Keeps the token in memory only: for tests, and as a fallback.
public final class InMemoryTokenStore: TokenStore {
    private var token: String?

    public init(_ initial: String? = nil) {
        token = initial
    }

    public func read() -> String? { token }

    @discardableResult
    public func write(_ token: String) -> Bool {
        self.token = token
        return true
    }

    public func delete() { token = nil }
}

/// The UserDefaults key older builds kept the token under, in plain text.
public let legacyTokenKey = "lectern_auth_token"

/// Moves a token left in UserDefaults into the store. Returns true when something was moved.
/// The UserDefaults value is removed only after the store confirmed the write, so a failed
/// write is tried again on the next launch and the user stays signed in.
@discardableResult
public func migrateLegacyToken(defaults: LegacyDefaults, store: TokenStore) -> Bool {
    guard let legacy = defaults.string(forKey: legacyTokenKey) else { return false }
    if legacy.isEmpty {
        defaults.removeObject(forKey: legacyTokenKey)
        return false
    }
    if let existing = store.read(), !existing.isEmpty {
        // The Keychain already has a token (a newer sign-in): keep it, drop the old copy.
        defaults.removeObject(forKey: legacyTokenKey)
        return false
    }
    guard store.write(legacy), store.read() == legacy else { return false }
    defaults.removeObject(forKey: legacyTokenKey)
    return true
}
