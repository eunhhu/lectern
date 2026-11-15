import LecternIntents
import LecternKit
import SwiftUI
import WidgetKit

/// What the home screen widgets read: the app's snapshot file and whether anyone is signed in
/// (the App Group's `default_workspace_id`; the snapshot alone cannot tell signed-out from empty).
struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
    let signedIn: Bool

    static func now() -> SnapshotEntry {
        SnapshotEntry(
            date: Date(),
            snapshot: WidgetSnapshotStore(containerURL: AppEnvironment.sharedContainerURL()).read(),
            signedIn: SharedDefaults.defaultWorkspaceID(in: SharedDefaults.group) != nil
        )
    }

    static let placeholder = SnapshotEntry(
        date: Date(),
        snapshot: WidgetSnapshot(recent: [.init(id: "placeholder", title: "자료구조 3주차", date: Date())]),
        signedIn: true
    )
}

/// No network: the app writes the file and reloads the timelines.
struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(context.isPreview ? .placeholder : .now())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        completion(Timeline(entries: [.now()], policy: .never))
    }
}

/// The latest documents; a tap opens one.
struct RecentDocumentsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "com.qucord.lectern.recent-documents", provider: SnapshotProvider()) { entry in
            RecentDocumentsView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("최근 문서")
        .description("Lectern의 최근 문서를 봅니다.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private struct RecentDocumentsView: View {
    let entry: SnapshotEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("최근 문서", systemImage: "doc.text")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if !entry.signedIn {
                Spacer()
                Text("로그인이 필요합니다")
                    .font(.subheadline)
                Spacer()
            } else if entry.snapshot.recent.isEmpty {
                Spacer()
                Text("아직 문서가 없습니다")
                    .font(.subheadline)
                Spacer()
            } else {
                // A small widget is one tap area (its links are ignored): one document, opened by
                // widgetURL. Medium: each row is a link.
                ForEach(entry.snapshot.recent.prefix(family == .systemSmall ? 1 : 4)) { document in
                    Link(destination: Self.url(document)) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(verbatim: document.title)
                                .font(.subheadline.weight(.medium))
                                .lineLimit(family == .systemSmall ? 3 : 1)
                            Text(document.date, format: .dateTime.month().day())
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(family == .systemSmall ? entry.snapshot.recent.first.map(Self.url) : nil)
    }

    private static func url(_ document: WidgetSnapshot.Document) -> URL {
        URL(string: "lectern://recordings/\(document.id)") ?? URL(string: "lectern://library")!
    }
}
