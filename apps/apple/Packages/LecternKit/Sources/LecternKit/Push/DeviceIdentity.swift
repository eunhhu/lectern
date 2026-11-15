import Foundation

/// This device's id for push (`push_device.id`): a UUID made on first use and kept in the
/// Keychain (`device_id`), so it survives app updates. Whether it survives deleting and
/// reinstalling the app is the Keychain's rule (MANUAL_CHECKS).
public struct DeviceIdentity: Sendable {
    public static let key = "device_id"
    private let store: TokenStore

    public init(store: TokenStore) {
        self.store = store
    }

    /// The id, made and saved the first time.
    public var id: String {
        if let existing = store.read(Self.key), Self.isValid(existing) { return existing }
        let made = UUID().uuidString.lowercased()
        store.write(made, for: Self.key)
        return made
    }

    /// The server's `PushDeviceId`: `[A-Za-z0-9_-]{1,64}`.
    static func isValid(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 64 && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }
}
