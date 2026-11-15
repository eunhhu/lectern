import Foundation

/// Where credentials live: the Keychain in the apps, memory in tests. Never UserDefaults.
public protocol TokenStore: Sendable {
    func read(_ key: String) -> String?
    @discardableResult func write(_ value: String, for key: String) -> Bool
    func delete(_ key: String)
}

/// The keys LecternKit stores.
public enum TokenKey {
    public static let apiToken = "api_token"
    public static let accessToken = "access_token"
    public static let refreshToken = "refresh_token"
}

/// Keeps values in memory only: tests and previews.
public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private var values: [String: String]
    private let lock = NSLock()

    public init(_ initial: [String: String] = [:]) {
        values = initial
    }

    public func read(_ key: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        return values[key]
    }

    @discardableResult
    public func write(_ value: String, for key: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        values[key] = value
        return true
    }

    public func delete(_ key: String) {
        lock.lock()
        defer { lock.unlock() }
        values[key] = nil
    }
}
