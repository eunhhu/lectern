import Foundation
import LecternIntents
import LecternKit
import LecternUI
import RecorderKit
import UIKit

/// One per process, made at launch (`LecternApp.init`) before any scene: an intent can wake the
/// app in the background to record, with no window and no `AppModel`. Holds the server client,
/// the one upload queue (one per store folder per process) with its background session, and the
/// recording session.
///
/// Uploads: in the foreground the queue runs itself (`run`). When the app is not active (a
/// recording stopped from the Lock Screen, or the app went to the background) jobs are handed to
/// the background URLSession, which goes on while the app is suspended. Only one of the two owns
/// a job at a time (`claimForBackground`, `run(skipping:)`).
@MainActor
final class AppServices {
    static let shared = AppServices()

    private(set) var environment: AppEnvironment
    private(set) var client: LecternClient
    private(set) var uploadQueue: UploadQueue?
    private(set) var backgroundUploader: BackgroundUploader?
    let recordingSession: RecordingSession?
    private let tokenStore: TokenStore

    private init() {
        let environment = AppEnvironment.current()
        self.environment = environment
        tokenStore = KeychainTokenStore(accessGroup: Self.keychainGroup)
        client = Self.makeClient(environment, store: tokenStore)
        recordingSession = environment.isFixture ? nil : Self.makeRecordingSession()
        makeUploadQueue()
        if let recordingSession {
            RecordingSession.install(recordingSession)
            Task { await recordingSession.cleanUpAfterLaunch() }
        }
    }

    // MARK: - Server and sign-in

    /// Another server: a new client and queue (credentials belong to a server, so this signs out
    /// first). False for an address that is not http(s).
    func setServerURL(_ text: String) async -> Bool {
        guard let url = AppEnvironment.validServerURL(text) else { return false }
        if url == environment.serverURL { return true }
        await signOut()
        UserDefaults.standard.set(url.absoluteString, forKey: AppEnvironment.serverURLKey)
        environment = AppEnvironment.current()
        client = Self.makeClient(environment, store: tokenStore)
        makeUploadQueue()
        return true
    }

    /// Intents record into the personal workspace of whoever is signed in.
    func remember(_ me: Me) {
        SharedDefaults.group?.set(me.personalWorkspaceID, forKey: SharedDefaults.defaultWorkspaceIDKey)
    }

    func signOut() async {
        await client.signOut()
        SharedDefaults.group?.removeObject(forKey: SharedDefaults.defaultWorkspaceIDKey)
    }

    // MARK: - Uploads

    /// Foreground: every runnable job, except those with a part in flight in the background.
    func runUploads() {
        guard let uploadQueue else { return }
        let uploader = backgroundUploader
        Task {
            let inFlight = await uploader?.inFlightJobIDs() ?? []
            await uploadQueue.run(skipping: inFlight)
        }
    }

    /// The app is going to the background: hand the runnable jobs to the background session.
    func handOffUploads() {
        guard let uploadQueue, backgroundUploader != nil else { return }
        withBackgroundTime {
            for job in await uploadQueue.jobs() where job.state.isRunnable {
                await self.handOff(job.id)
            }
        }
    }

    /// The recording session's `enqueue`. The queue is looked up now: a server change replaces it.
    func enqueueRecording(_ result: RecordingResult, draft: RecordingDraft) async throws {
        guard let uploadQueue else { throw RecordingError.failed("업로드 대기열을 열지 못했습니다. 녹음 파일은 기기에 남아 있습니다.") }
        let job = try UploadJob.recording(result, draft: draft, containerURL: AppEnvironment.sharedContainerURL())
        try await uploadQueue.enqueue(job)
        // Always the background session: the phone is often locked right after a stop (or it was
        // stopped from the Lock Screen), and the app is suspended within seconds once the audio
        // session is gone. A job in the foreground `run()` could not be handed over then.
        withBackgroundTime { await self.handOff(job.id) }
    }

    /// From the app delegate, when the system wakes the app for the background session's events.
    func handleBackgroundSessionEvents(identifier: String, completion: @escaping () -> Void) {
        guard identifier == BackgroundUploader.identifier, let backgroundUploader else { return completion() }
        backgroundUploader.handleEvents(completion: completion)
    }

    /// One job to the background session; when there is nothing to hand over (the server has
    /// every part already), the queue completes it now.
    private func handOff(_ id: String) async {
        guard let uploadQueue, let backgroundUploader else { return }
        if await !backgroundUploader.start(jobID: id) {
            await uploadQueue.run(skipping: await backgroundUploader.inFlightJobIDs())
        }
    }

    /// Runs `work` with time asked of the system, so a suspension does not cut it off halfway.
    private func withBackgroundTime(_ work: @escaping @MainActor () async -> Void) {
        let application = UIApplication.shared
        var taskID = UIBackgroundTaskIdentifier.invalid
        taskID = application.beginBackgroundTask(withName: "lectern.upload-handoff") {
            application.endBackgroundTask(taskID)
            taskID = .invalid
        }
        Task { @MainActor in
            await work()
            if taskID != .invalid { application.endBackgroundTask(taskID) }
            taskID = .invalid
        }
    }

    // MARK: - Making things

    /// `$(AppIdentifierPrefix)com.qucord.lectern` from the entitlements; nil in unsigned builds.
    private static var keychainGroup: String? {
        guard let prefix = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String, !prefix.isEmpty else { return nil }
        return prefix + "com.qucord.lectern"
    }

    private static func makeClient(_ environment: AppEnvironment, store: TokenStore) -> LecternClient {
        if environment.isFixture { return FixtureClient() }
        return LiveClient(serverURL: environment.serverURL, store: store, platform: "ios", deviceName: UIDevice.current.name)
    }

    private func makeUploadQueue() {
        backgroundUploader?.invalidate()
        guard let live = client as? LiveClient else {
            uploadQueue = nil
            backgroundUploader = nil
            return
        }
        let container = AppEnvironment.sharedContainerURL()
        let queue = UploadQueue(store: .inContainer(container), transport: LecternUploadTransport(api: live.api), containerURL: container)
        uploadQueue = queue
        backgroundUploader = BackgroundUploader(queue: queue, api: live.api, containerURL: container)
    }

    /// Recordings are written straight into the App Group container's `Recordings/`, where the
    /// upload queue reads them.
    private static func makeRecordingSession() -> RecordingSession {
        let directory = AppEnvironment.sharedContainerURL().appendingPathComponent(UploadJob.recordingsFolder, isDirectory: true)
        var hooks = RecordingHooks.system()
        let activate = hooks.activate
        hooks.activate = { recorder in
            // Playback would go on through the speaker into the recording.
            await MainActor.run { NotificationCenter.default.post(name: PlayerViewModel.pauseAllNotification, object: nil) }
            try await activate(recorder)
        }
        return RecordingSession(
            makeRecorder: {
                let input = EngineAudioInput()
                let recorder = Recorder(input: input, sink: FileAudioSink(), directory: directory)
                input.onInputLost = { [weak recorder] in
                    Task { await recorder?.handle(.routeLost) }
                }
                return recorder
            },
            activity: SystemRecordingActivity(),
            enqueue: { result, draft in
                try await AppServices.shared.enqueueRecording(result, draft: draft)
            },
            hooks: hooks
        )
    }
}
