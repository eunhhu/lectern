import XCTest
@testable import RecorderKit

final class RecorderKitTests: XCTestCase {
    func testName() {
        XCTAssertEqual(RecorderKitInfo.name, "RecorderKit")
    }
}
