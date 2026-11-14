import ActivityKit
import AppIntents
import LecternIntents
import SwiftUI
import WidgetKit

/// The recording on the Lock Screen and in the Dynamic Island. Recording is shown with a word and
/// an icon as well as the red color.
struct RecordingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            LockScreenRecordingView(title: context.attributes.title, state: context.state)
                .padding(16)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    RecordingMark(state: context.state, showsText: true)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ElapsedText(state: context.state)
                        .font(.title3.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(verbatim: context.attributes.title)
                            .font(.subheadline)
                            .lineLimit(1)
                        if context.state.silenceWarning {
                            SilenceWarning()
                        }
                        RecordingButtons(state: context.state)
                    }
                }
            } compactLeading: {
                RecordingMark(state: context.state, showsText: false)
            } compactTrailing: {
                ElapsedText(state: context.state)
                    .font(.caption.monospacedDigit())
                    .frame(maxWidth: 56)
            } minimal: {
                RecordingMark(state: context.state, showsText: false)
            }
        }
    }
}

private struct LockScreenRecordingView: View {
    let title: String
    let state: RecordingActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                RecordingMark(state: state, showsText: true)
                Spacer()
                ElapsedText(state: state)
                    .font(.title2.monospacedDigit().weight(.semibold))
            }
            Text(verbatim: title)
                .font(.headline)
                .lineLimit(1)
            if state.silenceWarning {
                SilenceWarning()
            }
            RecordingButtons(state: state)
        }
    }
}

/// The record dot (or pause / upload icon), with the state in words when there is room.
private struct RecordingMark: View {
    let state: RecordingActivityAttributes.ContentState
    let showsText: Bool

    var body: some View {
        Label {
            if showsText { Text(verbatim: state.statusText).font(.subheadline.weight(.semibold)) }
        } icon: {
            Image(systemName: icon)
                .foregroundStyle(state.phase == .recording ? Color.red : Color.secondary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(state.statusText)
    }

    private var icon: String {
        switch state.phase {
        case .recording: "record.circle.fill"
        case .paused: "pause.circle.fill"
        case .uploading: "arrow.up.circle.fill"
        case .finished: "checkmark.circle.fill"
        }
    }
}

/// A running timer while recording (the system draws it, no updates needed); fixed text otherwise.
private struct ElapsedText: View {
    let state: RecordingActivityAttributes.ContentState

    var body: some View {
        switch state.elapsedDisplay {
        case let .timer(since):
            Text(timerInterval: since...Date.distantFuture, countsDown: false)
                .multilineTextAlignment(.trailing)
        case let .fixed(text):
            Text(verbatim: text)
        }
    }
}

private struct SilenceWarning: View {
    var body: some View {
        Label(RecordingActivityAttributes.silenceText, systemImage: "mic.slash")
            .font(.footnote)
            .foregroundStyle(.orange)
    }
}

/// Pause/resume, "중요", stop. The intents run in the app's process. None once it has stopped.
private struct RecordingButtons: View {
    let state: RecordingActivityAttributes.ContentState

    var body: some View {
        if state.isLive {
            HStack(spacing: 8) {
                Button(intent: PauseResumeIntent()) {
                    Label(state.phase == .paused ? "재개" : "일시정지", systemImage: state.phase == .paused ? "play.fill" : "pause.fill")
                        .frame(maxWidth: .infinity)
                }
                Button(intent: AddMarkerIntent()) {
                    Label(state.markerCount > 0 ? "중요 \(state.markerCount)" : "중요", systemImage: "star.fill")
                        .frame(maxWidth: .infinity)
                }
                Button(intent: StopRecordingIntent()) {
                    Label("정지", systemImage: "stop.fill")
                        .frame(maxWidth: .infinity)
                }
                .tint(.red)
            }
            .buttonStyle(.bordered)
            .font(.footnote.weight(.semibold))
        }
    }
}
