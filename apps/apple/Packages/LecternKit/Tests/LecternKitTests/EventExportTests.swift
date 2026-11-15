@testable import LecternKit
import XCTest

final class EventExportTests: XCTestCase {
    private let server = URL(string: "https://lectern.example")!
    private let seoul = TimeZone(identifier: "Asia/Seoul")!

    private func candidate(start: String, end: String? = nil, allDay: Bool = false, tz: String = "Asia/Seoul", status: String = "accepted") -> EventCandidateModel {
        let parse = { (text: String) in try! Date.ISO8601FormatStyle().parse(text) }
        return EventCandidateModel(id: "evc_1", recordingID: "rec_9", title: "중간고사", kind: "exam", status: status, startAt: parse(start), endAt: end.map(parse), allDay: allDay, timeZoneID: tz)
    }

    private func day(_ date: Date, in zone: TimeZone) -> DateComponents {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
    }

    func testEventDraftTimed() {
        let draft = eventDraft(from: candidate(start: "2026-11-20T01:00:00Z"), serverURL: server)
        XCTAssertFalse(draft.isAllDay)
        XCTAssertEqual(draft.end.timeIntervalSince(draft.start), 3600)
        XCTAssertEqual(draft.timeZone, seoul)
    }

    func testEventDraftAllDay() {
        // Midnight 2026-11-20 in Seoul = 2026-11-19T15:00Z; exclusive end = the next midnight.
        let event = candidate(start: "2026-11-19T15:00:00Z", end: "2026-11-20T15:00:00Z", allDay: true)
        let draft = eventDraft(from: event, serverURL: server, deviceTimeZone: seoul)
        XCTAssertTrue(draft.isAllDay)
        XCTAssertEqual(day(draft.start, in: seoul), DateComponents(year: 2026, month: 11, day: 20, hour: 0, minute: 0))
        XCTAssertEqual(draft.start, draft.end)  // EventKit's all-day end is the day itself
    }

    func testEventDraftNotesAndUrl() {
        let draft = eventDraft(from: candidate(start: "2026-11-20T01:00:00Z"), serverURL: server)
        XCTAssertEqual(draft.notes, "Lectern 녹음에서 찾은 일정입니다.")
        XCTAssertEqual(draft.url.absoluteString, "https://lectern.example/app/recordings/rec_9")
        XCTAssertEqual(draft.title, "중간고사")
    }

    // MARK: - Beyond the spec

    func testAllDayKeepsItsDayOnADeviceFarAway() {
        // Seoul's 20 November on a phone in Los Angeles is still 20 November, not the 19th.
        let losAngeles = TimeZone(identifier: "America/Los_Angeles")!
        let event = candidate(start: "2026-11-19T15:00:00Z", end: "2026-11-20T15:00:00Z", allDay: true)
        let draft = eventDraft(from: event, serverURL: server, deviceTimeZone: losAngeles)
        XCTAssertEqual(day(draft.start, in: losAngeles), DateComponents(year: 2026, month: 11, day: 20, hour: 0, minute: 0))
        XCTAssertEqual(draft.timeZone, losAngeles)
    }

    func testMultiDayAllDayEndsOnTheLastDay() {
        // 20–22 November: the server's end is midnight on the 23rd.
        let event = candidate(start: "2026-11-19T15:00:00Z", end: "2026-11-22T15:00:00Z", allDay: true)
        let draft = eventDraft(from: event, serverURL: server, deviceTimeZone: seoul)
        XCTAssertEqual(day(draft.end, in: seoul), DateComponents(year: 2026, month: 11, day: 22, hour: 0, minute: 0))
    }

    func testTimedEndIsKept() {
        let draft = eventDraft(from: candidate(start: "2026-11-20T01:00:00Z", end: "2026-11-20T03:30:00Z"), serverURL: server)
        XCTAssertEqual(draft.end.timeIntervalSince(draft.start), 9000)
    }

    func testOnlyAcceptedEventsGoToTheCalendar() {
        XCTAssertTrue(candidate(start: "2026-11-20T01:00:00Z", status: "accepted").isAccepted)
        XCTAssertTrue(candidate(start: "2026-11-20T01:00:00Z", status: "synced").isAccepted)
        XCTAssertFalse(candidate(start: "2026-11-20T01:00:00Z", status: "suggested").isAccepted)
        XCTAssertFalse(candidate(start: "2026-11-20T01:00:00Z", status: "dismissed").isAccepted)
    }

    func testEventsDecodeLeniently() throws {
        let json = #"""
        {"items":[
          {"id":"evc_1","recording_id":"rec_9","title":"과제","kind":"future_kind","status":"accepted","start_at":"2026-11-20T01:00:00.000Z","end_at":null,"all_day":false,"tz":"Asia/Seoul","evidence":{"sources":[{"kind":"video"}]}},
          {"id":"broken"}
        ],"next_cursor":null}
        """#
        struct Page: Decodable { let items: [Item] }
        struct Item: Decodable { let value: EventCandidateModel?; init(from decoder: Decoder) throws { value = try? EventCandidateModel(from: decoder) } }
        let page = try LecternAPI.lenientDecoder.decode(Page.self, from: Data(json.utf8))
        let events = page.items.compactMap(\.value)
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events.first?.kind, "future_kind")
        XCTAssertNil(events.first?.endAt)
    }
}
