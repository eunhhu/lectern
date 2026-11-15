import ActivityKit
import LecternIntents
import LecternKit
import SwiftUI
import WidgetKit

/// A recording being processed, on the Lock Screen and in the Dynamic Island: the server's stage
/// label and progress (indeterminate when it gives none), then "문서 준비됨" with a link.
struct ProcessingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ProcessingActivityAttributes.self) { context in
            ProcessingLockScreenView(title: context.attributes.title, state: context.state)
                .padding(16)
                .widgetURL(context.attributes.openURL)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    ProcessingMark(state: context.state)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let fraction = context.state.fraction, !context.state.documentReady {
                        Text(verbatim: "\(Int((fraction * 100).rounded()))%")
                            .font(.caption.monospacedDigit())
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(verbatim: context.attributes.title)
                            .font(.subheadline)
                            .lineLimit(1)
                        ProcessingProgress(state: context.state)
                    }
                }
            } compactLeading: {
                ProcessingMark(state: context.state)
            } compactTrailing: {
                Text(verbatim: Self.shortLabel(context.state))
                    .font(.caption2)
                    .lineLimit(1)
                    .frame(maxWidth: 64)
            } minimal: {
                ProcessingMark(state: context.state)
            }
            .widgetURL(context.attributes.openURL)
        }
    }

    /// The stage label cut for the compact Dynamic Island.
    static func shortLabel(_ state: ProcessingContentState) -> String {
        if state.documentReady { return "준비됨" }
        return String(state.stageLabel.prefix(6))
    }
}

private struct ProcessingLockScreenView: View {
    let title: String
    let state: ProcessingContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                ProcessingMark(state: state)
                Text(verbatim: state.documentReady ? "문서 준비됨" : state.stageLabel)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if state.documentReady {
                    Text("열기")
                        .font(.subheadline.weight(.semibold))
                        .accessibilityHidden(true)
                }
            }
            Text(verbatim: title)
                .font(.headline)
                .lineLimit(1)
            if !state.documentReady {
                ProcessingProgress(state: state)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct ProcessingMark: View {
    let state: ProcessingContentState

    var body: some View {
        Image(systemName: state.documentReady ? "doc.text.fill" : "waveform.badge.magnifyingglass")
            .accessibilityLabel(state.documentReady ? "문서 준비됨" : "처리 중")
    }
}

private struct ProcessingProgress: View {
    let state: ProcessingContentState

    var body: some View {
        if let fraction = state.fraction {
            ProgressView(value: fraction)
                .accessibilityLabel("진행")
                .accessibilityValue("\(Int((fraction * 100).rounded()))퍼센트")
        } else {
            ProgressView()
                .progressViewStyle(.linear)
                .accessibilityLabel("처리 중")
        }
    }
}
