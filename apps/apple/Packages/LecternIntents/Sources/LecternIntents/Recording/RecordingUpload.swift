import Foundation
import LecternKit
import RecorderKit

extension UploadJob {
    public static let recordingsFolder = "Recordings"

    /// A finished recording as an upload job. The recorder writes into the App Group container's
    /// `Recordings/`; a file elsewhere is moved there first (the queue reads files by their path
    /// in the container). `recorded_at` is when the recording started; markers go with it.
    public static func recording(_ result: RecordingResult, draft: RecordingDraft, containerURL: URL, now: Date = Date()) throws -> UploadJob {
        var file = result.fileURL
        var relative = Self.path(of: file, in: containerURL)
        if relative == nil {
            let folder = containerURL.appendingPathComponent(recordingsFolder, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let destination = folder.appendingPathComponent(file.lastPathComponent)
            try FileManager.default.moveItem(at: file, to: destination)
            file = destination
            relative = "\(recordingsFolder)/\(file.lastPathComponent)"
        }
        let size = (try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value ?? 0
        return UploadJob(
            fileRelativePath: relative!,
            fileName: file.lastPathComponent,
            mimeType: "audio/mp4",
            byteCount: size,
            workspaceID: draft.workspaceID,
            folderID: draft.folderID,
            title: draft.title,
            recordedAt: result.startedAt,
            markers: result.markers.map { Marker(atMs: $0.atMs, label: $0.label) },
            now: now
        )
    }

    /// `file`'s path inside `container`, or nil when it is not inside (symlinks resolved: the
    /// temporary folder is /var → /private/var on Apple systems).
    static func path(of file: URL, in container: URL) -> String? {
        let filePath = file.resolvingSymlinksInPath().standardizedFileURL.path
        var base = container.resolvingSymlinksInPath().standardizedFileURL.path
        if !base.hasSuffix("/") { base += "/" }
        guard filePath.hasPrefix(base) else { return nil }
        return String(filePath.dropFirst(base.count))
    }
}
