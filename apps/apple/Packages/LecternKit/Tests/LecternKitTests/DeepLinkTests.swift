@testable import LecternKit
import XCTest

final class DeepLinkTests: XCTestCase {
    private let host = "lectern.example"

    private func parse(_ text: String) -> DeepLink? {
        parseDeepLink(URL(string: text)!, serverHost: host)
    }

    func testDeepLinks() {
        XCTAssertEqual(parse("lectern://recordings/rec_123"), .recording(id: "rec_123"))
        XCTAssertEqual(parse("lectern://library"), .library)
        XCTAssertEqual(parse("lectern://settings"), .settings)
        XCTAssertEqual(parse("https://lectern.example/app/recordings/0199f0a0-1000-7000-8000-00000000abcd"), .recording(id: "0199f0a0-1000-7000-8000-00000000abcd"))
        XCTAssertEqual(parse("https://lectern.example/app"), .library)
        XCTAssertEqual(parse("https://lectern.example/app/"), .library)
        XCTAssertEqual(parse("https://lectern.example/app/library"), .library)
        XCTAssertEqual(parse("https://lectern.example/app/settings"), .settings)
        XCTAssertEqual(parse("https://lectern.example/app/invite?token=inv_ABC-12"), .invite(token: "inv_ABC-12"))
        XCTAssertEqual(parse("https://lectern.example/s/shr_abc"), .share(token: "shr_abc"))
        XCTAssertEqual(parse("https://LECTERN.example/app/recordings/rec_1"), .recording(id: "rec_1"))
    }

    func testDeepLinkRejectsOtherHosts() {
        XCTAssertNil(parse("https://evil.example/app/recordings/rec_1"))
        XCTAssertNil(parseDeepLink(URL(string: "https://lectern.example/app/recordings/rec_1")!, serverHost: nil))
        XCTAssertNil(parse("https://lectern.example/app/recordings/..%2Fx"))
        XCTAssertNil(parse("lectern://recordings/..%2Fx"))
        XCTAssertNil(parse("https://lectern.example/app/recordings/a/b"))
        XCTAssertNil(parse("https://lectern.example/app/unknown"))
        XCTAssertNil(parse("https://lectern.example/privacy"))
        XCTAssertNil(parse("https://lectern.example/app/invite"))
        XCTAssertNil(parse("lectern://elsewhere"))
        XCTAssertNil(parse("ftp://lectern.example/app"))
        XCTAssertNil(parse("https://lectern.example/app/recordings/" + String(repeating: "a", count: 129)))
    }
}
