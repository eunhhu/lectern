import XCTest
@testable import LecternKit

final class LecternKitTests: XCTestCase {
    func testName() {
        XCTAssertEqual(LecternKitInfo.name, "LecternKit")
    }
}
