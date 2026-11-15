import Foundation
@testable import LecternIntents
import LecternKit
import XCTest

private final class FakeActivities: ProcessingActivityController, @unchecked Sendable {
    private let lock = NSLock()
    private var ids: [String] = []
    private var ended: [String] = []
    private var refuse = false

    var running: [String] { lock.withLock { ids } }
    var endedIDs: [String] { lock.withLock { ended } }
    func refuseStarts() { lock.withLock { refuse = true } }

    func running() async -> [String] { lock.withLock { ids } }

    func start(attributes: ProcessingActivityAttributes, state: ProcessingContentState) async -> Bool {
        lock.withLock {
            guard !refuse else { return false }
            ids.append(attributes.recordingID)
            return true
        }
    }

    func end(recordingID: String) async {
        lock.withLock {
            ids.removeAll { $0 == recordingID }
            ended.append(recordingID)
        }
    }

    func endAll() async {
        lock.withLock {
            ended += ids
            ids = []
        }
    }
}

private final class FakePush: PushAPI, @unchecked Sendable {
    private let lock = NSLock()
    private var log: [String] = []
    var calls: [String] { lock.withLock { log } }
    private func note(_ call: String) { lock.withLock { log.append(call) } }

    func upsertPushDevice(deviceID: String, registration: PushDeviceRegistration) async throws { note("upsert") }
    func deletePushDevice(deviceID: String) async throws { note("delete") }
    func setLiveActivity(recordingID: String, deviceID: String, pushToken: String) async throws { note("set \(recordingID) \(pushToken)") }
    func endLiveActivity(recordingID: String, deviceID: String) async throws { note("end \(recordingID)") }
}

/// The server's APNs fixtures, read from the repository.
private func serverFixture(_ name: String, file: StaticString = #filePath) throws -> [String: Any] {
    var url = URL(fileURLWithPath: "\(file)")
    for _ in 0..<7 { url.deleteLastPathComponent() }  // …/Tests/LecternIntentsTests/x.swift → repository root
    let data = try Data(contentsOf: url.appendingPathComponent("apps/server/test/fixtures/apns/\(name)"))
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

final class ProcessingActivityTests: XCTestCase {
    func testDecodesServerLiveActivityStart() throws {
        let aps = try XCTUnwrap(try serverFixture("live-activity-start.json")["aps"] as? [String: Any])
        XCTAssertEqual(aps["attributes-type"] as? String, "ProcessingActivityAttributes")
        XCTAssertEqual(aps["attributes-type"] as? String, String(describing: ProcessingActivityAttributes.self))
        XCTAssertEqual(ProcessingActivityAttributes.typeName, String(describing: ProcessingActivityAttributes.self))
        let attributes = try JSONDecoder().decode(
            ProcessingActivityAttributes.self, from: JSONSerialization.data(withJSONObject: try XCTUnwrap(aps["attributes"]))
        )
        XCTAssertEqual(attributes.recordingID, "0199f0a0-1000-7000-8000-00000000abcd")
        XCTAssertEqual(attributes.title, "자료구조 3주차")
        let state = try JSONDecoder().decode(
            ProcessingActivityAttributes.ContentState.self, from: JSONSerialization.data(withJSONObject: try XCTUnwrap(aps["content-state"]))
        )
        XCTAssertEqual(state.stageLabel, "노트 구성 중")
    }

    func testProcessingActivityLimit() async {
        let activities = FakeActivities()
        let coordinator = ProcessingActivityCoordinator(controller: activities, api: FakePush(), deviceID: "dev_1")
        for i in 1...6 {
            await coordinator.uploadFinished(recordingID: "rec_\(i)", title: "강의 \(i)")
        }
        XCTAssertEqual(activities.running, ["rec_2", "rec_3", "rec_4", "rec_5", "rec_6"])
        XCTAssertEqual(activities.endedIDs, ["rec_1"])
    }

    func testLiveActivityTokenIsSentOnChange() async {
        let push = FakePush()
        let coordinator = ProcessingActivityCoordinator(controller: FakeActivities(), api: push, deviceID: "dev_1")
        await coordinator.pushTokenChanged(recordingID: "rec_1", token: "aa")
        await coordinator.pushTokenChanged(recordingID: "rec_1", token: "aa")
        await coordinator.pushTokenChanged(recordingID: "rec_1", token: "bb")
        XCTAssertEqual(push.calls, ["set rec_1 aa", "set rec_1 bb"])
    }

    // MARK: - Beyond the spec

    func testSameRecordingIsNotStartedTwice() async {
        let activities = FakeActivities()
        let coordinator = ProcessingActivityCoordinator(controller: activities, api: FakePush(), deviceID: "dev_1")
        await coordinator.uploadFinished(recordingID: "rec_1", title: "강의")
        await coordinator.uploadFinished(recordingID: "rec_1", title: "강의")
        XCTAssertEqual(activities.running, ["rec_1"])
    }

    func testEndedActivityTellsTheServerOnce() async {
        let push = FakePush()
        let coordinator = ProcessingActivityCoordinator(controller: FakeActivities(), api: push, deviceID: "dev_1")
        await coordinator.pushTokenChanged(recordingID: "rec_1", token: "aa")
        await coordinator.activityEnded(recordingID: "rec_1")
        await coordinator.activityEnded(recordingID: "rec_1")
        XCTAssertEqual(push.calls, ["set rec_1 aa", "end rec_1"])
    }

    func testSignOutEndsEveryActivity() async {
        let activities = FakeActivities()
        let coordinator = ProcessingActivityCoordinator(controller: activities, api: FakePush(), deviceID: "dev_1")
        await coordinator.uploadFinished(recordingID: "rec_1", title: "강의")
        await coordinator.uploadFinished(recordingID: "rec_2", title: "강의")
        await coordinator.signOut()
        XCTAssertEqual(activities.running, [])
        XCTAssertEqual(activities.endedIDs, ["rec_1", "rec_2"])
    }

    func testRefusedStartIsNotAnError() async {
        let activities = FakeActivities()
        activities.refuseStarts()
        let coordinator = ProcessingActivityCoordinator(controller: activities, api: FakePush(), deviceID: "dev_1")
        await coordinator.uploadFinished(recordingID: "rec_1", title: "강의")
        XCTAssertEqual(activities.running, [])
    }

    func testOpenURL() {
        XCTAssertEqual(ProcessingActivityAttributes(recordingID: "rec_1", title: "x").openURL.absoluteString, "lectern://recordings/rec_1")
    }
}
