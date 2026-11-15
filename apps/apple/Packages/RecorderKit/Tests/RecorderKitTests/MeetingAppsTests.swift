@testable import RecorderKit
import XCTest

final class MeetingAppsTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_792_387_800)

    func testKnownMeetingApp() {
        XCTAssertEqual(meetingApp(bundleID: "us.zoom.xos")?.name, "Zoom")
        XCTAssertNil(meetingApp(bundleID: "com.apple.Safari"))
    }

    func testPromptOnlyWhenEnabledAndIdle() {
        var prompter = MeetingPrompter()
        XCTAssertNil(prompter.shouldPrompt(launchedBundleID: "us.zoom.xos", isRecording: false, enabled: false, now: start))
        XCTAssertNil(prompter.shouldPrompt(launchedBundleID: "us.zoom.xos", isRecording: true, enabled: true, now: start))
        XCTAssertNil(prompter.shouldPrompt(launchedBundleID: "com.apple.Safari", isRecording: false, enabled: true, now: start))
        // None of those counted as a prompt: the first real one still comes.
        XCTAssertEqual(prompter.shouldPrompt(launchedBundleID: "us.zoom.xos", isRecording: false, enabled: true, now: start)?.name, "Zoom")
    }

    func testPromptCooldown() {
        var prompter = MeetingPrompter()
        XCTAssertNotNil(prompter.shouldPrompt(launchedBundleID: "us.zoom.xos", isRecording: false, enabled: true, now: start))
        XCTAssertNil(prompter.shouldPrompt(launchedBundleID: "us.zoom.xos", isRecording: false, enabled: true, now: start.addingTimeInterval(10 * 60)))
        XCTAssertEqual(
            prompter.shouldPrompt(launchedBundleID: "us.zoom.xos", isRecording: false, enabled: true, now: start.addingTimeInterval(31 * 60))?.bundleID,
            "us.zoom.xos"
        )
    }

    func testDifferentAppsPromptIndependently() {
        var prompter = MeetingPrompter()
        XCTAssertEqual(prompter.shouldPrompt(launchedBundleID: "us.zoom.xos", isRecording: false, enabled: true, now: start)?.name, "Zoom")
        XCTAssertEqual(prompter.shouldPrompt(launchedBundleID: "com.microsoft.teams2", isRecording: false, enabled: true, now: start)?.name, "Microsoft Teams")
    }

    // MARK: - Beyond the spec

    func testEveryListedAppIsKnown() {
        for bundleID in ["us.zoom.xos", "com.microsoft.teams2", "com.microsoft.teams", "com.cisco.webexmeetingsapp", "Cisco-Systems.Spark", "com.apple.FaceTime"] {
            XCTAssertNotNil(meetingApp(bundleID: bundleID), bundleID)
        }
    }
}
