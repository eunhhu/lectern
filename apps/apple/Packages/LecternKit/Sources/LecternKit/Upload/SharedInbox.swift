import Foundation
import UniformTypeIdentifiers

public enum SharedInboxError: Error, Equatable, LocalizedError, Sendable {
    case noSpace

    public var errorDescription: String? {
        switch self {
        case .noSpace: "기기의 저장 공간이 부족합니다."
        }
    }
}

public struct ImportSummary: Sendable, Equatable {
    public var recordings: Int
    public var pdfsPaired: Int
    public var pdfsUnpaired: Int
    /// Names of files left out: not audio or PDF, empty, or audio over 2 GB.
    public var ignored: [String]

    public init(recordings: Int, pdfsPaired: Int, pdfsUnpaired: Int, ignored: [String]) {
        self.recordings = recordings
        self.pdfsPaired = pdfsPaired
        self.pdfsUnpaired = pdfsUnpaired
        self.ignored = ignored
    }
}

/// Files shared to Lectern (the share extension). They are paired like the web does
/// (`pairFiles`), copied into the App Group container's `Inbox/<uuid>/<name>` (one folder per
/// file: two shared files may have the same name), and each recording becomes an upload job in
/// the queue's store. The app's queue uploads them (`UploadQueue.reloadFromStore`); the extension
/// never uploads (its memory is limited). Jobs are saved only after every file of the share is
/// copied, so the app never sees a job whose file is still on the way, and a failed share leaves
/// nothing behind (a retry does not queue the same recording twice).
public struct SharedInbox: Sendable {
    public static let inboxFolder = "Inbox"
    /// Where the share extension copies a provider's file while its temporary file still exists.
    public static let stagingFolder = "ShareStaging"
    /// Leftovers of a share the system ended halfway are removed after this long.
    public static let leftoverAge: TimeInterval = 24 * 3600
    public static let maxAudioBytes: Int64 = 2 * 1024 * 1024 * 1024
    /// Room left over after a copy.
    public static let spareBytes: Int64 = 200 * 1024 * 1024

    /// A shared file and the name to keep (a provider's suggested name may differ from the URL's).
    public struct Item: Sendable {
        public var url: URL
        public var name: String

        public init(url: URL, name: String? = nil) {
            self.url = url
            self.name = name ?? url.lastPathComponent
        }
    }

    private let containerURL: URL
    private let store: UploadQueueStore
    private let freeBytes: @Sendable (URL) -> Int64?
    private let fileSize: @Sendable (URL) -> Int64?
    private let readRecordedDate: @Sendable (URL, Date) async -> Date?

    public init(containerURL: URL, store: UploadQueueStore) {
        self.init(
            containerURL: containerURL,
            store: store,
            freeBytes: { SharedInbox.availableBytes(at: $0) },
            fileSize: { SharedInbox.size(of: $0) },
            recordedDate: { url, notAfter in await LecternKit.recordedDate(of: url, notAfter: notAfter) }
        )
    }

    init(
        containerURL: URL,
        store: UploadQueueStore,
        freeBytes: @escaping @Sendable (URL) -> Int64?,
        fileSize: @escaping @Sendable (URL) -> Int64?,
        recordedDate: @escaping @Sendable (URL, Date) async -> Date?
    ) {
        self.containerURL = containerURL
        self.store = store
        self.freeBytes = freeBytes
        self.fileSize = fileSize
        readRecordedDate = recordedDate
    }

    /// What adding would do, without copying anything (the confirmation screen).
    public func preview(_ items: [Item], timeZone: TimeZone, now: Date) -> ImportSummary {
        plan(items, timeZone: timeZone, now: now).summary
    }

    public func importFiles(_ urls: [URL], workspaceID: String, folderID: String?, timeZone: TimeZone, now: Date) async throws -> ImportSummary {
        try await importItems(urls.map { Item(url: $0) }, workspaceID: workspaceID, folderID: folderID, timeZone: timeZone, now: now)
    }

    /// `now`: when the share began (file dates at or after it are a copy's, not the recording's).
    public func importItems(_ items: [Item], workspaceID: String, folderID: String?, timeZone: TimeZone, now: Date) async throws -> ImportSummary {
        let plan = plan(items, timeZone: timeZone, now: now)
        let copied = plan.result.groups.flatMap { group in group.audio + group.pdfs.map(\.file) }
        let total = copied.reduce(Int64(0)) { $0 + $1.size }
        try FileManager.default.createDirectory(at: containerURL, withIntermediateDirectories: true)
        if total > 0, let free = freeBytes(containerURL), free < total + Self.spareBytes {
            throw SharedInboxError.noSpace
        }
        var folders: [URL] = []
        var jobs: [UploadJob] = []
        do {
            for group in plan.result.groups {
                func copy(_ file: PairFile) throws -> String {
                    let item = plan.items[Int(file.id)!]
                    let folderName = UUID().uuidString.lowercased()
                    let folder = containerURL.appendingPathComponent(Self.inboxFolder, isDirectory: true).appendingPathComponent(folderName, isDirectory: true)
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    folders.append(folder)
                    let name = Self.sanitize(item.name)
                    try FileManager.default.copyItem(at: item.url, to: folder.appendingPathComponent(name))
                    return "\(Self.inboxFolder)/\(folderName)/\(name)"
                }
                let audioPaths = try group.audio.map(copy)
                let pdfPaths = try group.pdfs.map { try copy($0.file) }
                let lead = group.audio[0]
                let leadURL = plan.items[Int(lead.id)!].url
                let recordedAt = await readRecordedDate(leadURL, now) ?? group.recordedAt
                let fileName = (audioPaths[0] as NSString).lastPathComponent
                let job = UploadJob(
                    fileRelativePath: audioPaths[0],
                    fileName: fileName,
                    mimeType: UploadJob.audioMimeType(forExtension: extensionOf(fileName)) ?? lead.type ?? "application/octet-stream",
                    byteCount: lead.size,
                    workspaceID: workspaceID,
                    folderID: folderID,
                    title: group.title,
                    recordedAt: recordedAt,
                    audioPartRelativePaths: Array(audioPaths.dropFirst()),
                    pdfRelativePaths: pdfPaths,
                    now: now
                )
                jobs.append(job)
            }
            var saved: [String] = []
            do {
                for job in jobs {
                    try store.save(job)
                    saved.append(job.id)
                }
            } catch {
                for id in saved { try? store.delete(id) }
                throw error
            }
        } catch {
            for folder in folders { try? FileManager.default.removeItem(at: folder) }
            throw error
        }
        return plan.summary
    }

    /// At app launch: removes what a share the system ended halfway left behind, once it is older
    /// than `leftoverAge` (so a share in progress is never touched): staging folders, and Inbox
    /// folders no queued job refers to.
    public func removeLeftovers(now: Date) {
        let fileManager = FileManager.default
        func old(_ url: URL) -> Bool {
            guard let modified = (try? fileManager.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date else { return false }
            return now.timeIntervalSince(modified) > Self.leftoverAge
        }
        func children(_ folder: String) -> [URL] {
            let url = containerURL.appendingPathComponent(folder, isDirectory: true)
            return (try? fileManager.contentsOfDirectory(at: url, includingPropertiesForKeys: nil)) ?? []
        }
        for leftover in children(Self.stagingFolder) where old(leftover) {
            try? fileManager.removeItem(at: leftover)
        }
        let referenced = Set(store.load().flatMap(\.allRelativePaths).compactMap { path -> String? in
            let parts = path.split(separator: "/")
            return parts.count >= 2 && parts[0] == Substring(Self.inboxFolder) ? String(parts[1]) : nil
        })
        for folder in children(Self.inboxFolder) where !referenced.contains(folder.lastPathComponent) && old(folder) {
            try? fileManager.removeItem(at: folder)
        }
    }

    // MARK: - Plan

    private struct Plan {
        var items: [Item]
        var result: PairingResult
        var summary: ImportSummary
    }

    private func plan(_ items: [Item], timeZone: TimeZone, now: Date) -> Plan {
        var files: [PairFile] = []
        var oversized = Set<Int>()
        for (index, item) in items.enumerated() {
            let name = item.name.precomposedStringWithCanonicalMapping
            let type = UTType(filenameExtension: extensionOf(name))?.preferredMIMEType
            let size = fileSize(item.url) ?? 0
            let modified = (try? item.url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate).flatMap { $0 < now ? $0 : nil }
            let file = PairFile(name: name, type: type, lastModified: modified, size: size, id: String(index))
            if classifyFile(name: name, type: type) == .audio, size > Self.maxAudioBytes {
                oversized.insert(index)
            } else {
                files.append(file)
            }
        }
        let result = pairFiles(files, timeZone: timeZone)
        let rejected = Set(result.rejected.map { Int($0.file.id)! })
        let ignored = items.indices.filter { oversized.contains($0) || rejected.contains($0) }.map { items[$0].name }
        let summary = ImportSummary(
            recordings: result.groups.count,
            pdfsPaired: result.groups.reduce(0) { $0 + $1.pdfs.count },
            pdfsUnpaired: result.unmatched.count,
            ignored: ignored
        )
        return Plan(items: items, result: result, summary: summary)
    }

    // MARK: - Helpers

    /// No path separators, no leading dots ("../a/b.m4a" → "_a_b.m4a"), never empty.
    public static func sanitize(_ name: String) -> String {
        var out = name.precomposedStringWithCanonicalMapping
        for separator in ["/", "\\", ":"] { out = out.replacingOccurrences(of: separator, with: "_") }
        out = String(out.drop { $0 == "." })
        return out.isEmpty ? "file" : out
    }

    static func availableBytes(at url: URL) -> Int64? {
        (try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?.volumeAvailableCapacityForImportantUsage
    }

    static func size(of url: URL) -> Int64? {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value
    }
}
