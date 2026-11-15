import Foundation

/// A calendar event the server found in a recording (`EventCandidate`), read leniently: `kind`
/// and `status` stay strings so a value this app does not know still decodes.
public struct EventCandidateModel: Sendable, Equatable, Identifiable, Decodable {
    public let id: String
    public let recordingID: String
    public let title: String
    public let kind: String
    public let status: String
    /// UTC. For an all-day event: local midnight in `timeZoneID`, as a UTC instant.
    public let startAt: Date
    /// UTC, exclusive. For an all-day event: local midnight after the last day.
    public let endAt: Date?
    public let allDay: Bool
    public let timeZoneID: String

    public init(id: String, recordingID: String, title: String, kind: String, status: String, startAt: Date, endAt: Date?, allDay: Bool, timeZoneID: String) {
        self.id = id
        self.recordingID = recordingID
        self.title = title
        self.kind = kind
        self.status = status
        self.startAt = startAt
        self.endAt = endAt
        self.allDay = allDay
        self.timeZoneID = timeZoneID
    }

    enum CodingKeys: String, CodingKey {
        case id, title, kind, status
        case recordingID = "recording_id"
        case startAt = "start_at"
        case endAt = "end_at"
        case allDay = "all_day"
        case timeZoneID = "tz"
    }

    /// The user accepted it (on the web): it may go to the device's calendar.
    public var isAccepted: Bool { status == "accepted" || status == "synced" }
}

/// What goes into an EventKit event.
public struct EventDraft: Equatable, Sendable {
    public var title: String
    public var start: Date
    public var end: Date
    public var isAllDay: Bool
    public var timeZone: TimeZone
    public var notes: String
    public var url: URL

    public static let notesText = "Lectern 녹음에서 찾은 일정입니다."
}

/// The EventKit values for an event:
/// - timed: the end is the start + 1 hour when the server has none;
/// - all-day: the event's own calendar day(s), rebuilt in `deviceTimeZone` (EventKit keeps an
///   all-day event's dates in the device's zone; the server's start is midnight in the event's
///   zone, which is another day elsewhere). EventKit's all-day end is the last day itself, not
///   the midnight after it as on the server (and in ICS).
public func eventDraft(from candidate: EventCandidateModel, serverURL: URL, deviceTimeZone: TimeZone = .current) -> EventDraft {
    let eventZone = TimeZone(identifier: candidate.timeZoneID) ?? deviceTimeZone
    let url = serverURL.appendingPathComponent("app").appendingPathComponent("recordings").appendingPathComponent(candidate.recordingID)
    guard candidate.allDay else {
        let end = candidate.endAt.flatMap { $0 > candidate.startAt ? $0 : nil } ?? candidate.startAt.addingTimeInterval(3600)
        return EventDraft(title: candidate.title, start: candidate.startAt, end: end, isAllDay: false, timeZone: eventZone, notes: EventDraft.notesText, url: url)
    }
    var eventCalendar = Calendar(identifier: .gregorian)
    eventCalendar.timeZone = eventZone
    var deviceCalendar = Calendar(identifier: .gregorian)
    deviceCalendar.timeZone = deviceTimeZone
    /// The same calendar day (year, month, day) at midnight on the device.
    func sameDay(_ instant: Date) -> Date {
        let day = eventCalendar.dateComponents([.year, .month, .day], from: instant)
        return deviceCalendar.date(from: day) ?? instant
    }
    let start = sameDay(candidate.startAt)
    var end = start
    if let endAt = candidate.endAt, endAt > candidate.startAt {
        // Exclusive midnight after the last day → the last day.
        let lastDay = sameDay(endAt.addingTimeInterval(-1))
        if lastDay > start { end = lastDay }
    }
    return EventDraft(title: candidate.title, start: start, end: end, isAllDay: true, timeZone: deviceTimeZone, notes: EventDraft.notesText, url: url)
}
