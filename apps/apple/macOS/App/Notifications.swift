import Foundation
import LecternKit
import UserNotifications

/// "문서가 준비되었습니다" when a recording uploaded from this Mac has its document. There is no
/// push here (P6-A11): a recording whose upload finished is checked every 30 seconds until it is
/// ready, fails or is a few hours old. The menu bar app keeps running with no window, so the
/// check goes on after the main window closes. Clicking the notification opens the recording.
@MainActor
final class ReadyNotifier: NSObject, UNUserNotificationCenterDelegate {
    static let title = "문서가 준비되었습니다"
    /// [recording id: when its upload finished (seconds since 1970)].
    static let pendingKey = "ready_pending"
    /// Upload jobs already seen done (so a relaunch does not count them again).
    static let seenJobsKey = "ready_seen_jobs"
    static let maxAge: TimeInterval = 6 * 60 * 60
    private static let interval: UInt64 = 30_000_000_000
    private nonisolated static let recordingIDKey = "recording_id"

    var onOpen: ((String) -> Void)?
    var onUnauthorized: (() -> Void)?
    private let defaults: UserDefaults
    private var client: LecternClient?
    private var poller: Task<Void, Never>?
    private var sawFirstJobs = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        super.init()
        // Before launch finishes: a click on a notification can be what launched the app.
        UNUserNotificationCenter.current().delegate = self
    }

    /// The client to ask (a server change makes a new one).
    func start(client: LecternClient) {
        self.client = client
        poller?.cancel()
        poller = nil
        pollIfNeeded()
    }

    /// Signed out or another server: stop watching (another account would get 403s for 6 hours).
    func reset() {
        poller?.cancel()
        poller = nil
        pending = [:]
    }

    /// Asked when the first recording ends, not at launch. The system asks only once.
    func askPermissionOnce() {
        Task {
            let center = UNUserNotificationCenter.current()
            guard await center.notificationSettings().authorizationStatus == .notDetermined else { return }
            _ = try? await center.requestAuthorization(options: [.alert, .sound])
        }
    }

    /// The upload queue changed: jobs that just finished uploading are watched.
    func jobsChanged(_ jobs: [UploadJob]) {
        var seen = Set(defaults.stringArray(forKey: Self.seenJobsKey) ?? [])
        var pending = self.pending
        let now = Date().timeIntervalSince1970
        for job in jobs {
            guard case let .done(recordingID) = job.state, !seen.contains(job.id) else { continue }
            seen.insert(job.id)
            // Jobs already done at launch finished in an earlier run: not news now.
            if sawFirstJobs { pending[recordingID] = now }
        }
        sawFirstJobs = true
        let present = Set(jobs.map(\.id))
        defaults.set(Array(seen.intersection(present)), forKey: Self.seenJobsKey)
        self.pending = pending
        pollIfNeeded()
    }

    // MARK: - Checking

    private var pending: [String: Double] {
        get { defaults.dictionary(forKey: Self.pendingKey) as? [String: Double] ?? [:] }
        set { defaults.set(newValue, forKey: Self.pendingKey) }
    }

    private func pollIfNeeded() {
        guard poller == nil, client != nil, !pending.isEmpty else { return }
        poller = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: Self.interval)
                guard let self, !Task.isCancelled else { return }
                if await !self.check() { break }
            }
            self?.poller = nil
        }
    }

    /// One round. False when there is nothing left to watch (or nobody is signed in).
    private func check() async -> Bool {
        guard let client else { return false }
        let now = Date().timeIntervalSince1970
        for (id, finishedAt) in pending {
            if now - finishedAt > Self.maxAge {
                drop(id)
                continue
            }
            do {
                let detail = try await client.recording(id: id)
                switch detail.recording.status {
                case .ready:
                    drop(id)
                    await notify(recordingID: id, title: detail.recording.title)
                case .partial, .failed, .canceled:
                    drop(id)
                case .uploading, .queued, .processing, .unknown:
                    break
                }
            } catch APIError.notFound, APIError.forbidden {
                drop(id)
            } catch APIError.unauthorized {
                onUnauthorized?()
                return false
            } catch {
                // Offline: try again next round.
            }
        }
        return !pending.isEmpty
    }

    private func drop(_ id: String) {
        var pending = self.pending
        pending[id] = nil
        self.pending = pending
    }

    private func notify(recordingID: String, title: String) async {
        let content = UNMutableNotificationContent()
        content.title = Self.title
        content.body = title
        content.sound = .default
        content.userInfo = [Self.recordingIDKey: recordingID]
        let request = UNNotificationRequest(identifier: "ready-\(recordingID)", content: content, trigger: nil)
        try? await UNUserNotificationCenter.current().add(request)
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Shown even while Lectern is the active app.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let id = response.notification.request.content.userInfo[Self.recordingIDKey] as? String else { return }
        await MainActor.run { self.onOpen?(id) }
    }
}
