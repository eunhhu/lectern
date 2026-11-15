import AVFoundation
import Foundation
import LecternKit

/// One recording: its document, transcript and audio. Sources and transcript lines seek the
/// player and start it.
@MainActor
public final class RecordingViewModel: ObservableObject {
    public enum Tab: Hashable, Sendable {
        case document, transcript
    }

    @Published public private(set) var phase: Phase = .loading
    @Published public private(set) var detail: RecordingDetail?
    @Published public private(set) var document: LecternKit.Document?
    @Published public private(set) var transcript: Transcript?
    @Published public var tab: Tab = .document

    public let player: PlayerViewModel
    public var onUnauthorized: (@MainActor () -> Void)?

    private let recordingID: String
    private let client: LecternClient
    private let playback: Playback
    /// The loaded recording, for the player's item loader (made before `self` exists).
    private let loaded = LoadedRecording()

    /// `playback` stands in for the player in tests.
    public init(recordingID: String, client: LecternClient, playback: Playback? = nil) {
        self.recordingID = recordingID
        self.client = client
        let loaded = loaded
        let player = PlayerViewModel(loadItem: {
            guard let detail = loaded.detail, let url = try await client.audioURL(for: detail) else { throw PlayerUnavailable() }
            return AVPlayerItem(url: url)
        })
        self.player = player
        self.playback = playback ?? player
    }

    public var title: String { detail?.recording.title ?? "" }

    /// Shown in place of the document, when there is none to show.
    public var documentMessage: String? {
        guard let detail, document == nil else { return nil }
        switch detail.recording.status {
        case .uploading, .queued, .processing: return ScreenText.processing
        case .failed, .canceled: return ScreenText.failed
        default: return transcript != nil ? ScreenText.transcriptOnly : ScreenText.failed
        }
    }

    public func load() async {
        phase = .loading
        do {
            let detail = try await client.recording(id: recordingID)
            self.detail = detail
            loaded.detail = detail
            if let id = detail.documentID {
                document = try await optional { try await self.client.document(id: id) }
            }
            if [.ready, .partial].contains(detail.recording.status) || document != nil {
                transcript = try await optional { try await self.client.transcript(recordingID: self.recordingID) }
            }
            phase = .loaded
        } catch {
            guard !ScreenText.isCancellation(error) else { return }
            if case APIError.unauthorized = error { onUnauthorized?() }
            phase = .failed(ScreenText.message(for: error))
        }
    }

    /// A source chip: a transcript source plays from its first segment.
    public func play(source: SourceRef) {
        guard case let .transcript(startIdx, endIdx) = source,
              let range = SourceResolver(transcript: transcript).range(startIdx: startIdx, endIdx: endIdx)
        else { return }  // PDF pages open in a PDF view (not in this app yet)
        play(fromMs: range.startMs)
    }

    /// A transcript line.
    public func play(fromMs ms: Int) {
        playback.seek(toMs: ms)
        playback.play()
    }

    /// nil for 404 (no document yet, no transcript yet); other errors are thrown.
    private func optional<T>(_ load: () async throws -> T) async throws -> T? {
        do {
            return try await load()
        } catch APIError.notFound {
            return nil
        }
    }
}

/// Written on the main actor by `load()`, read by the player's loader (also on the main actor).
private final class LoadedRecording: @unchecked Sendable {
    var detail: RecordingDetail?
}

struct PlayerUnavailable: Error, LocalizedError {
    var errorDescription: String? { "이 녹음에는 재생할 오디오가 없습니다." }
}
