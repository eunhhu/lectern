import Foundation

/// The queue on disk: one `<id>.json` per job in a folder (the App Group container's
/// `UploadQueue/` in the apps). A write goes to a temporary file that then replaces the entry,
/// so a crash leaves the old entry or the new one, never half of one. An entry that does not
/// decode is moved aside to `<id>.json.corrupt`.
public final class UploadQueueStore: @unchecked Sendable {
    public let directory: URL
    private let fileManager = FileManager.default
    private let lock = NSLock()

    public init(directory: URL) {
        self.directory = directory
    }

    /// `<container>/UploadQueue`.
    public static func inContainer(_ containerURL: URL) -> UploadQueueStore {
        UploadQueueStore(directory: containerURL.appendingPathComponent("UploadQueue", isDirectory: true))
    }

    static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        // Milliseconds, not ISO 8601 whole seconds: a stored date must come back as it was.
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return decoder
    }()

    func url(of id: String) -> URL { directory.appendingPathComponent("\(id).json") }

    /// Every readable job, oldest first.
    public func load() -> [UploadJob] {
        lock.lock()
        defer { lock.unlock() }
        guard let names = try? fileManager.contentsOfDirectory(atPath: directory.path) else { return [] }
        var jobs: [UploadJob] = []
        for name in names where name.hasSuffix(".json") {
            let file = directory.appendingPathComponent(name)
            do {
                jobs.append(try Self.decoder.decode(UploadJob.self, from: Data(contentsOf: file)))
            } catch {
                let aside = file.appendingPathExtension("corrupt")
                try? fileManager.removeItem(at: aside)
                try? fileManager.moveItem(at: file, to: aside)
            }
        }
        return jobs.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
    }

    /// Writes one job atomically.
    public func save(_ job: UploadJob) throws {
        lock.lock()
        defer { lock.unlock() }
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try Self.encoder.encode(job)
        let temporary = directory.appendingPathComponent(".\(job.id).\(UUID().uuidString).tmp")
        try data.write(to: temporary)
        let target = url(of: job.id)
        if fileManager.fileExists(atPath: target.path) {
            _ = try fileManager.replaceItemAt(target, withItemAt: temporary)
        } else {
            try fileManager.moveItem(at: temporary, to: target)
        }
    }

    public func delete(_ id: String) throws {
        lock.lock()
        defer { lock.unlock() }
        let target = url(of: id)
        if fileManager.fileExists(atPath: target.path) { try fileManager.removeItem(at: target) }
    }
}
