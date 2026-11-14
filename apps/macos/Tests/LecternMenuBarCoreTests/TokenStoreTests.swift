import XCTest
@testable import LecternMenuBarCore

/// UserDefaults stand-in: the tests never touch UserDefaults.standard or the real Keychain.
private final class FakeDefaults: LegacyDefaults {
    var values: [String: String]

    init(_ values: [String: String] = [:]) {
        self.values = values
    }

    func string(forKey defaultName: String) -> String? { values[defaultName] }
    func removeObject(forKey defaultName: String) { values[defaultName] = nil }
}

/// A store whose writes always fail (a locked or unavailable Keychain).
private final class FailingStore: TokenStore {
    func read() -> String? { nil }
    func write(_ token: String) -> Bool { false }
    func delete() {}
}

final class TokenStoreTests: XCTestCase {
    func testMovesLegacyToken() {
        let defaults = FakeDefaults([legacyTokenKey: "abc"])
        let store = InMemoryTokenStore()
        XCTAssertTrue(migrateLegacyToken(defaults: defaults, store: store))
        XCTAssertEqual(store.read(), "abc")
        XCTAssertNil(defaults.string(forKey: legacyTokenKey))
    }

    func testNothingToMove() {
        let defaults = FakeDefaults()
        let store = InMemoryTokenStore("kept")
        XCTAssertFalse(migrateLegacyToken(defaults: defaults, store: store))
        XCTAssertEqual(store.read(), "kept")
    }

    func testEmptyLegacyValueIsRemoved() {
        let defaults = FakeDefaults([legacyTokenKey: ""])
        let store = InMemoryTokenStore()
        XCTAssertFalse(migrateLegacyToken(defaults: defaults, store: store))
        XCTAssertNil(defaults.string(forKey: legacyTokenKey))
        XCTAssertNil(store.read())
    }

    func testKeepsExistingKeychainToken() {
        let defaults = FakeDefaults([legacyTokenKey: "old"])
        let store = InMemoryTokenStore("new")
        XCTAssertFalse(migrateLegacyToken(defaults: defaults, store: store))
        XCTAssertEqual(store.read(), "new")
        XCTAssertNil(defaults.string(forKey: legacyTokenKey))
    }

    func testFailedWriteKeepsLegacyValue() {
        let defaults = FakeDefaults([legacyTokenKey: "abc"])
        XCTAssertFalse(migrateLegacyToken(defaults: defaults, store: FailingStore()))
        XCTAssertEqual(defaults.string(forKey: legacyTokenKey), "abc")
    }

    func testRunningTwiceIsHarmless() {
        let defaults = FakeDefaults([legacyTokenKey: "abc"])
        let store = InMemoryTokenStore()
        XCTAssertTrue(migrateLegacyToken(defaults: defaults, store: store))
        XCTAssertFalse(migrateLegacyToken(defaults: defaults, store: store))
        XCTAssertEqual(store.read(), "abc")
    }

    func testInMemoryStoreRoundTrip() {
        let store = InMemoryTokenStore()
        XCTAssertTrue(store.write("token-1"))
        XCTAssertEqual(store.read(), "token-1")
        store.delete()
        XCTAssertNil(store.read())
    }
}
