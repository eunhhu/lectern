import EventKit
import LecternIntents
import LecternKit
import LecternUI
import SwiftUI

/// Puts an accepted event into the device's default calendar (write-only access: the app cannot
/// read the calendar back, so it remembers which events it added).
@MainActor
enum CalendarExporter {
    static let exportedKey = "calendar_exported_event_ids"
    static let addedText = "캘린더에 추가했습니다."
    static let alreadyText = "이미 캘린더에 추가했습니다."
    static let deniedText = "캘린더 권한이 필요합니다. 설정에서 Lectern의 캘린더 접근을 켜 주세요."
    static let failedText = "캘린더에 추가하지 못했습니다."

    private static var defaults: UserDefaults { SharedDefaults.group ?? .standard }

    static func isExported(_ candidate: EventCandidateModel) -> Bool {
        Set(defaults.stringArray(forKey: exportedKey) ?? []).contains(candidate.id)
    }

    /// The sentence to show.
    static func add(_ candidate: EventCandidateModel, serverURL: URL) async -> String {
        guard !isExported(candidate) else { return alreadyText }
        let store = EKEventStore()
        do {
            guard try await store.requestWriteOnlyAccessToEvents() else { return deniedText }
        } catch {
            return deniedText
        }
        let draft = eventDraft(from: candidate, serverURL: serverURL)
        let event = EKEvent(eventStore: store)
        event.title = draft.title
        event.startDate = draft.start
        event.endDate = draft.end
        event.isAllDay = draft.isAllDay
        event.timeZone = draft.isAllDay ? nil : draft.timeZone
        event.notes = draft.notes
        event.url = draft.url
        guard let calendar = store.defaultCalendarForNewEvents else { return failedText }
        event.calendar = calendar
        do {
            try store.save(event, span: .thisEvent)
        } catch {
            return failedText
        }
        var exported = defaults.stringArray(forKey: exportedKey) ?? []
        exported.append(candidate.id)
        defaults.set(exported, forKey: exportedKey)
        return addedText
    }
}

/// The events the server found in a recording; the accepted ones can go to the calendar.
struct RecordingEventsSheet: View {
    let events: [EventCandidateModel]
    let serverURL: URL
    @Environment(\.dismiss) private var dismiss
    @State private var messages: [String: String] = [:]

    var body: some View {
        NavigationStack {
            List(events) { event in
                VStack(alignment: .leading, spacing: LecternTokens.Space.s4) {
                    Text(verbatim: event.title)
                        .lecternFont(.title)
                    Text(verbatim: Self.when(event))
                        .lecternFont(.caption)
                        .foregroundStyle(Theme.textSecondary)
                    if event.isAccepted {
                        Button("캘린더에 추가") {
                            Task { messages[event.id] = await CalendarExporter.add(event, serverURL: serverURL) }
                        }
                        .buttonStyle(.bordered)
                        .disabled(messages[event.id] == CalendarExporter.addedText)
                    } else {
                        Text("웹에서 수락하면 캘린더에 넣을 수 있습니다.")
                            .lecternFont(.caption)
                            .foregroundStyle(Theme.textTertiary)
                    }
                    if let message = messages[event.id] {
                        Text(verbatim: message)
                            .lecternFont(.caption)
                            .foregroundStyle(message == CalendarExporter.addedText ? Theme.accentText : Theme.tone(.danger).text)
                    }
                }
                .padding(.vertical, LecternTokens.Space.s4)
            }
            .navigationTitle("일정")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("닫기") { dismiss() }
                }
            }
        }
    }

    private static func when(_ event: EventCandidateModel) -> String {
        let draft = eventDraft(from: event, serverURL: URL(string: "https://lectern.invalid")!)
        if draft.isAllDay {
            return draft.start.formatted(.dateTime.year().month().day().weekday()) + " (하루 종일)"
        }
        return draft.start.formatted(.dateTime.month().day().weekday().hour().minute())
    }
}
