import XCTest

/// Runs the app on fixtures (no server). Not part of the gate (it needs a booted simulator):
/// `xcodebuild test -project apps/apple/Lectern.xcodeproj -scheme LecterniOS -destination 'platform=iOS Simulator,name=iPhone 17'`
final class LibraryFlowUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testOpensARecordingInFixtureMode() {
        let app = XCUIApplication()
        app.launchArguments = ["-LECTERN_FIXTURE", "1"]
        app.launch()

        // The recording list comes first (iPhone: preferredCompactColumn = .content).
        let firstRow = app.descendants(matching: .any).matching(identifier: "recording.row").firstMatch
        XCTAssertTrue(firstRow.waitForExistence(timeout: 10))
        firstRow.tap()

        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "recording.title").firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["요약"].waitForExistence(timeout: 10))  // the document's first section

        app.buttons["전사"].tap()
        let line = app.descendants(matching: .any).matching(identifier: "transcript.row").firstMatch
        XCTAssertTrue(line.waitForExistence(timeout: 10))
    }
}
