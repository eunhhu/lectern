import AVFoundation
import Combine
import Foundation

/// What a screen does with the player when a source or a transcript line is pressed.
@MainActor
public protocol Playback: AnyObject {
    func seek(toMs ms: Int)
    func play()
}

/// Playback of a recording's audio. The item is loaded on the first play (a credentialed asset
/// URL is fetched only when needed). Position updates ten times a second. When the item fails
/// (the credential in its URL expired during a long playback), it is loaded once more and
/// playback goes on from the same place.
@MainActor
public final class PlayerViewModel: ObservableObject, Playback {
    public nonisolated static let rates: [Float] = [0.75, 1, 1.25, 1.5, 2]
    public static let failedMessage = "오디오를 재생하지 못했습니다."

    @Published public private(set) var positionMs = 0
    @Published public private(set) var durationMs = 0
    @Published public private(set) var isPlaying = false
    /// The last load error, in the server's or the system's words.
    @Published public private(set) var errorMessage: String?
    /// One of `rates`. Setting it while paused does not start playback.
    @Published public var rate: Float = 1 {
        didSet {
            player?.defaultRate = rate
            if isPlaying { player?.rate = rate }
        }
    }

    private let loadItem: () async throws -> AVPlayerItem
    private var player: AVPlayer?
    private var loading = false
    private var pendingSeekMs: Int?
    /// The item played to its end: the next play starts from the beginning.
    private var reachedEnd = false
    /// A failed item was already reloaded once; cleared when the new one is ready.
    private var reloadedAfterFailure = false
    private var playerCancellables: Set<AnyCancellable> = []
    private var itemCancellables: Set<AnyCancellable> = []
    // Read in deinit, which is not on the main actor.
    nonisolated(unsafe) private var timeObserver: Any?
    nonisolated(unsafe) private var observedPlayer: AVPlayer?

    public init(loadItem: @escaping () async throws -> AVPlayerItem) {
        self.loadItem = loadItem
    }

    deinit {
        if let timeObserver, let observedPlayer {
            observedPlayer.removeTimeObserver(timeObserver)
        }
    }

    public func toggle() {
        isPlaying ? pause() : play()
    }

    public func pause() {
        player?.pause()
        isPlaying = false
    }

    public func play() {
        Self.activatePlaybackSession()
        if let player {
            if reachedEnd {
                reachedEnd = false
                seek(toMs: 0)
            }
            player.playImmediately(atRate: rate)
            isPlaying = true
            return
        }
        guard !loading else { return }  // a second tap while the item is still loading
        loading = true
        errorMessage = nil
        Task {
            defer { loading = false }
            do {
                let item = try await loadItem()
                use(item)
                player?.playImmediately(atRate: rate)
                isPlaying = true
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    /// Before the item is loaded, the position is kept and applied once it is.
    public func seek(toMs ms: Int) {
        let target = Self.clamp(ms, durationMs: durationMs)
        positionMs = target
        reachedEnd = false
        guard let player else {
            pendingSeekMs = target
            return
        }
        player.seek(to: CMTime(value: CMTimeValue(target), timescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    public func skip(bySeconds seconds: Int) {
        seek(toMs: positionMs + seconds * 1000)
    }

    /// Within 0...duration. While the duration is unknown (0), only the lower bound applies.
    public nonisolated static func clamp(_ ms: Int, durationMs: Int) -> Int {
        let lower = max(0, ms)
        return durationMs > 0 ? min(lower, durationMs) : lower
    }

    /// The next speed in `rates`, wrapping around; a rate not in the list goes to the next larger one.
    public nonisolated static func nextRate(after rate: Float) -> Float {
        if let index = rates.firstIndex(of: rate) {
            return rates[(index + 1) % rates.count]
        }
        return rates.first { $0 > rate } ?? rates[0]
    }

    /// iOS: spoken-audio playback that the silent switch and the lock screen do not stop. Not while
    /// a recording holds the session (.playAndRecord): changing the category would stop it.
    private static func activatePlaybackSession() {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        guard session.category != .playAndRecord else { return }
        try? session.setCategory(.playback, mode: .spokenAudio)
        try? session.setActive(true)
        #endif
    }

    // MARK: - Items

    private func use(_ item: AVPlayerItem) {
        let player = self.player ?? makePlayer()
        itemCancellables = []
        player.replaceCurrentItem(with: item)
        NotificationCenter.default.publisher(for: AVPlayerItem.didPlayToEndTimeNotification, object: item)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.reachedEnd = true
                self?.isPlaying = false
            }
            .store(in: &itemCancellables)
        NotificationCenter.default.publisher(for: AVPlayerItem.failedToPlayToEndTimeNotification, object: item)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.itemFailed(item) }
            .store(in: &itemCancellables)
        item.publisher(for: \.status)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status in
                switch status {
                case .readyToPlay: self?.reloadedAfterFailure = false
                case .failed: self?.itemFailed(item)
                default: break
                }
            }
            .store(in: &itemCancellables)
        Task { [weak self] in
            guard let duration = try? await item.asset.load(.duration), duration.isNumeric else { return }
            self?.durationMs = Int(duration.seconds * 1000)
        }
        if let pendingSeekMs {
            self.pendingSeekMs = nil
            player.seek(to: CMTime(value: CMTimeValue(pendingSeekMs), timescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero)
        }
    }

    private func makePlayer() -> AVPlayer {
        let player = AVPlayer()
        player.defaultRate = rate
        self.player = player
        observedPlayer = player
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 10), queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self, time.isNumeric else { return }
                self.positionMs = Int(time.seconds * 1000)
            }
        }
        player.publisher(for: \.timeControlStatus)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status in self?.isPlaying = status != .paused }
            .store(in: &playerCancellables)
        return player
    }

    private func itemFailed(_ item: AVPlayerItem) {
        let wasPlaying = isPlaying
        guard !reloadedAfterFailure else {
            errorMessage = item.error?.localizedDescription ?? Self.failedMessage
            isPlaying = false
            return
        }
        reloadedAfterFailure = true
        let resumeAt = positionMs
        Task {
            do {
                let fresh = try await loadItem()
                pendingSeekMs = resumeAt
                use(fresh)
                if wasPlaying { player?.playImmediately(atRate: rate) }
            } catch {
                errorMessage = error.localizedDescription
                isPlaying = false
            }
        }
    }
}
