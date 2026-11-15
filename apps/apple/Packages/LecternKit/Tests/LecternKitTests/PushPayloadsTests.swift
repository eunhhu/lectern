@testable import LecternKit
import XCTest

/// The server's own APNs fixtures (`apps/server/test/fixtures/apns`), read from the repository:
/// the app decodes exactly what the server sends.
func serverAPNsFixture(_ name: String, file: StaticString = #filePath) throws -> [String: Any] {
    var url = URL(fileURLWithPath: "\(file)")
    for _ in 0..<7 { url.deleteLastPathComponent() }  // …/Tests/LecternKitTests/x.swift → repository root
    let data = try Data(contentsOf: url.appendingPathComponent("apps/server/test/fixtures/apns/\(name)"))
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

final class PushPayloadsTests: XCTestCase {
    private func contentState(_ fixture: String) throws -> ProcessingContentState {
        let payload = try serverAPNsFixture(fixture)
        let aps = try XCTUnwrap(payload["aps"] as? [String: Any])
        let state = try XCTUnwrap(aps["content-state"])
        return try JSONDecoder().decode(ProcessingContentState.self, from: JSONSerialization.data(withJSONObject: state))
    }

    func testDecodesServerLiveActivityUpdate() throws {
        let state = try contentState("live-activity-update.json")
        XCTAssertEqual(state.stage, "structure")
        XCTAssertEqual(state.stageLabel, "노트 구성 중")
        XCTAssertEqual(state.progress, 80)
        XCTAssertEqual(state.recordingID, "0199f0a0-1000-7000-8000-00000000abcd")
        XCTAssertFalse(state.documentReady)
        XCTAssertEqual(state.fraction, 0.8)
    }

    func testDecodesServerLiveActivityEnd() throws {
        let state = try contentState("live-activity-end.json")
        XCTAssertTrue(state.documentReady)
        XCTAssertEqual(state.stage, "done")
    }

    func testDecodesAlerts() throws {
        let ready = try XCTUnwrap(decodeAlert(userInfo: try serverAPNsFixture("alert-ready.json")))
        XCTAssertEqual(ready.recordingID, "0199f0a0-1000-7000-8000-00000000abcd")
        XCTAssertEqual(ready.url.absoluteString, "https://lectern.example/app/recordings/0199f0a0-1000-7000-8000-00000000abcd")
        XCTAssertEqual(ready.title, "문서가 준비되었습니다")
        XCTAssertEqual(ready.body, "자료구조 3주차")

        let failed = try XCTUnwrap(decodeAlert(userInfo: try serverAPNsFixture("alert-failed.json")))
        XCTAssertEqual(failed.recordingID, "0199f0a0-1000-7000-8000-00000000abcd")
        XCTAssertEqual(failed.title, "녹음을 처리하지 못했습니다")
    }

    func testUnknownStageStillDecodes() throws {
        let json = #"{"stage":"future_stage","stage_label":"새 단계","recording_id":"rec_1","document_ready":false,"extra":1}"#
        let state = try JSONDecoder().decode(ProcessingContentState.self, from: Data(json.utf8))
        XCTAssertEqual(state.stage, "future_stage")
        XCTAssertNil(state.progress)
        XCTAssertNil(state.fraction)
    }

    func testContentStateEncodesSnakeCase() throws {
        let state = ProcessingContentState(stage: "transcribe", stageLabel: "전사 중", progress: 40, recordingID: "rec_1", documentReady: false)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any])
        XCTAssertEqual(Set(object.keys), ["stage", "stage_label", "progress", "recording_id", "document_ready"])
        XCTAssertEqual(object["stage_label"] as? String, "전사 중")
    }

    // MARK: - Beyond the spec

    func testNonServerNotificationIsNoAlert() {
        XCTAssertNil(decodeAlert(userInfo: ["aps": ["alert": "hi"]]))
        XCTAssertNil(decodeAlert(userInfo: ["recording_id": "rec_1"]))
    }
}
