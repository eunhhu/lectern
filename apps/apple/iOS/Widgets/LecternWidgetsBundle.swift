import SwiftUI
import WidgetKit

@main
struct LecternWidgetsBundle: WidgetBundle {
    var body: some Widget {
        LecternPlaceholderWidget()
    }
}

/// Holds the extension's place until the real widgets and the Live Activity arrive.
struct LecternPlaceholderWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LecternPlaceholder", provider: PlaceholderProvider()) { _ in
            Text("Lectern")
        }
        .configurationDisplayName("Lectern")
    }
}

struct PlaceholderEntry: TimelineEntry {
    let date: Date
}

struct PlaceholderProvider: TimelineProvider {
    func placeholder(in context: Context) -> PlaceholderEntry { PlaceholderEntry(date: .now) }

    func getSnapshot(in context: Context, completion: @escaping (PlaceholderEntry) -> Void) {
        completion(PlaceholderEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PlaceholderEntry>) -> Void) {
        completion(Timeline(entries: [PlaceholderEntry(date: .now)], policy: .never))
    }
}
