@testable import LecternKit
import XCTest

final class LegacyMacTokenTests: XCTestCase {
    func testLegacyPlanAdoptsToken() {
        XCTAssertEqual(legacyMigrationPlan(newStoreHasCredential: false, legacyToken: "lct_abc"), .adopt("lct_abc"))
        XCTAssertEqual(legacyMigrationPlan(newStoreHasCredential: false, legacyToken: " lct_abc\n"), .adopt("lct_abc"))
    }

    func testLegacyPlanKeepsNewCredential() {
        XCTAssertEqual(legacyMigrationPlan(newStoreHasCredential: true, legacyToken: "lct_abc"), .none)
    }

    func testLegacyPlanNoLegacy() {
        XCTAssertEqual(legacyMigrationPlan(newStoreHasCredential: false, legacyToken: nil), .none)
        XCTAssertEqual(legacyMigrationPlan(newStoreHasCredential: false, legacyToken: ""), .none)
        XCTAssertEqual(legacyMigrationPlan(newStoreHasCredential: false, legacyToken: "  "), .none)
    }

    func testTheOldAppsKeychainNames() {
        XCTAssertEqual(LegacyMacToken.service, "com.qucord.lectern.macos")
        XCTAssertEqual(LegacyMacToken.account, "auth_token")
    }
}
