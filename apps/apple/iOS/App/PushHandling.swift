import LecternIntents
import LecternKit
import os
import UIKit
import UserNotifications
import WidgetKit

/// What reaches the user outside the app (P6-A11): push registration, the processing Live
/// Activities, the "document ready" alerts, Spotlight and the widgets' snapshot. Made with
/// `AppServices` at launch, before any scene, so it is the notification delegate even when a
/// tap on an alert is what launched the app.
@MainActor
final class SystemSurfaces: NSObject, UNUserNotificationCenterDelegate {
    nonisolated static let documentReadyCategory = "DOCUMENT_READY"
    nonisolated static let openAction = "open"
    /// Upload jobs already seen done (a relaunch does not start their activities again).
    static let seenJobsKey = "processing_seen_jobs"

    private(set) var registration: PushRegistration?
    private(set) var coordinator: ProcessingActivityCoordinator?
    private var observer: Task<Void, Never>?
    private var sawFirstJobs = false
    /// The first upload finished: ask for notifications when the app is next in front.
    private var wantsPermission = false
    private let widgets = WidgetSnapshotStore(containerURL: AppEnvironment.sharedContainerURL())
    private let deviceName = UIDevice.current.name
    private static let log = Logger(subsystem: "com.qucord.lectern", category: "push")

    override init() {
        super.init()
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        // The server's alerts carry no category yet: the default tap opens the document too.
        let open = UNNotificationAction(identifier: Self.openAction, title: "열기", options: [.foreground])
        center.setNotificationCategories([UNNotificationCategory(identifier: Self.documentReadyCategory, actions: [open], intentIdentifiers: [])])
    }

    /// A server client (launch, server change): push goes to that server, as this device.
    func connect(api: PushAPI?, deviceID: String?) {
        observer?.cancel()
        observer = nil
        guard let api, let deviceID else {
            registration = nil
            coordinator = nil
            return
        }
        let registration = PushRegistration(api: api, deviceID: deviceID, name: deviceName, appVersion: Self.appVersion)
        let coordinator = ProcessingActivityCoordinator(controller: SystemProcessingActivity(), api: api, deviceID: deviceID)
        self.registration = registration
        self.coordinator = coordinator
        observer = ProcessingActivityObserver.start(coordinator: coordinator, registration: registration)
        Task { await registerIfAllowed() }
    }

    func signedIn() {
        let registration = registration
        Task {
            await registration?.signedIn()
            await registerIfAllowed()
        }
    }

    /// Deletes the push device before the credentials go, ends the processing activities, and
    /// clears Spotlight and the widgets (no titles left on the Lock Screen).
    func signOut(clearCredentials: @escaping @Sendable () async -> Void) async {
        if let registration {
            await registration.signOut(clearCredentials: clearCredentials)
        } else {
            await clearCredentials()
        }
        await coordinator?.signOut()
        await SpotlightIndexer.removeAll()
        widgets.clear()
        WidgetCenter.shared.reloadAllTimelines()
        RecordingDirectory.shared.uninstall()
    }

    /// From the app delegate.
    func apnsTokenArrived(_ token: Data) {
        let registration = registration
        Task { await registration?.apnsTokenChanged(token) }
    }

    /// The upload queue changed: a job that just finished uploading starts its processing
    /// activity (in the foreground; from the background the server's push-to-start brings it).
    func jobsChanged(_ jobs: [UploadJob]) {
        let defaults = UserDefaults.standard
        var seen = Set(defaults.stringArray(forKey: Self.seenJobsKey) ?? [])
        for job in jobs {
            guard case let .done(recordingID) = job.state, !seen.contains(job.id) else { continue }
            seen.insert(job.id)
            // Jobs already done at launch finished in an earlier run.
            guard sawFirstJobs else { continue }
            wantsPermission = true
            let title = job.title ?? (job.fileName as NSString).deletingPathExtension
            let coordinator = coordinator
            Task { await coordinator?.uploadFinished(recordingID: recordingID, title: title) }
        }
        sawFirstJobs = true
        defaults.set(Array(seen.intersection(jobs.map(\.id))), forKey: Self.seenJobsKey)
        if wantsPermission, UIApplication.shared.applicationState == .active { askPermission() }
    }

    func appBecameActive() {
        if wantsPermission { askPermission() }
    }

    /// Spotlight takes every list; the widgets only the whole workspace's.
    func listLoaded(folderID: String?, recordings: [RecordingSummary], folders: [Folder]) {
        let names = Dictionary(folders.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        Task { await SpotlightIndexer.index(recordings, folderNames: names) }
        guard folderID == nil else { return }
        do {
            try widgets.write(WidgetSnapshot(recordings: recordings))
        } catch {
            Self.log.error("widgets: writing the snapshot failed: \(error.localizedDescription, privacy: .public)")
        }
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: - Permission

    private func askPermission() {
        wantsPermission = false
        Task {
            let center = UNUserNotificationCenter.current()
            if await center.notificationSettings().authorizationStatus == .notDetermined {
                _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
            }
            await registerIfAllowed()
        }
    }

    private func registerIfAllowed() async {
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        guard status == .authorized || status == .provisional || status == .ephemeral else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    private static var appVersion: String {
        let info = Bundle.main.infoDictionary ?? [:]
        return "\(info["CFBundleShortVersionString"] as? String ?? "?") (\(info["CFBundleVersion"] as? String ?? "?"))"
    }

    /// An alert came in: that recording is no longer "processing" in the widget.
    private func alertArrived(recordingID: String) {
        var snapshot = widgets.read()
        guard snapshot.processing.contains(where: { $0.id == recordingID }) else { return }
        snapshot.processing.removeAll { $0.id == recordingID }
        try? widgets.write(snapshot)
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Shown as a banner while the app is in front too.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        if let alert = decodeAlert(userInfo: notification.request.content.userInfo) {
            await MainActor.run { self.alertArrived(recordingID: alert.recordingID) }
        }
        return [.banner, .list, .sound]
    }

    /// A tap (or `열기`) opens the recording.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier || response.actionIdentifier == Self.openAction,
              let alert = decodeAlert(userInfo: response.notification.request.content.userInfo) else { return }
        await MainActor.run { LinkRouter.shared.open(.recording(id: alert.recordingID)) }
    }
}
