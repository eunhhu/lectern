import AVFoundation
import Foundation

/// When an audio file was recorded: ① the file's own `creationDate` metadata, ② the file
/// system's creation date, ③ nil. A date in the future or before 2000 is not believed.
///
/// `notAfter`: the moment the share began. A file handed to a share extension is a fresh copy
/// whose file-system dates may be "now"; a creation date at or after that moment says nothing
/// about the recording, and dropping it lets the date in the file name have its turn.
public func recordedDate(of url: URL, notAfter: Date = Date()) async -> Date? {
    if let date = await metadataCreationDate(of: url), plausible(date, notAfter: notAfter, inclusive: true) {
        return date
    }
    if let date = try? url.resourceValues(forKeys: [.creationDateKey]).creationDate, plausible(date, notAfter: notAfter, inclusive: false) {
        return date
    }
    return nil
}

private let earliest = Date(timeIntervalSince1970: 946_684_800)  // 2000-01-01T00:00:00Z

private func plausible(_ date: Date, notAfter: Date, inclusive: Bool) -> Bool {
    date >= earliest && (inclusive ? date <= notAfter : date < notAfter)
}

private func metadataCreationDate(of url: URL) async -> Date? {
    let asset = AVURLAsset(url: url)
    guard let item = try? await asset.load(.creationDate) else { return nil }
    if let date = try? await item.load(.dateValue) { return date }
    // Some files carry it as text ("2026-10-19T14:30:05+0900").
    guard let text = try? await item.load(.stringValue) else { return nil }
    return ISO8601DateFormatter().date(from: text)
}
