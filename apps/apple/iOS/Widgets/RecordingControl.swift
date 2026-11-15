import AppIntents
import LecternIntents
import SwiftUI
import WidgetKit

/// "녹음" in Control Center, on the Lock Screen and on the Action button. On starts a recording
/// without opening the app; off stops it. The state comes from the App Group's
/// `recording_active`, which the recording session writes.
struct RecordingControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: SharedDefaults.recordingControlKind, provider: RecordingControlValue()) { isOn in
            ControlWidgetToggle("녹음", isOn: isOn, action: RecordingToggleIntent()) { on in
                Label(on ? "녹음 중" : "녹음", systemImage: on ? "stop.circle.fill" : "record.circle")
            }
            .tint(.red)
        }
        .displayName("녹음")
        .description("Lectern으로 녹음을 시작하거나 멈춥니다.")
    }
}

struct RecordingControlValue: ControlValueProvider {
    var previewValue: Bool { false }

    func currentValue() async throws -> Bool {
        SharedDefaults.isRecording(in: SharedDefaults.group)
    }
}
