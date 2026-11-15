import LecternKit
import SwiftUI
import WidgetKit

/// How many recordings are being processed, and the first one's stage.
struct ProcessingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.qucord.lectern.processing", provider: SnapshotProvider()) { entry in
            ProcessingWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("처리 중인 녹음")
        .description("서버에서 처리 중인 녹음을 봅니다.")
        .supportedFamilies([.systemSmall])
    }
}

private struct ProcessingWidgetView: View {
    let entry: SnapshotEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("처리 중", systemImage: "waveform")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if !entry.signedIn {
                Text("로그인이 필요합니다")
                    .font(.subheadline)
            } else if let first = entry.snapshot.processing.first {
                Text(verbatim: "\(entry.snapshot.processing.count)개")
                    .font(.title.weight(.semibold).monospacedDigit())
                Text(verbatim: first.title)
                    .font(.caption)
                    .lineLimit(1)
                Text(verbatim: first.stageLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                Text("처리 중인 녹음이 없습니다")
                    .font(.subheadline)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(entry.snapshot.processing.first.flatMap { URL(string: "lectern://recordings/\($0.id)") })
    }
}
