import AppKit
import AVFoundation
import Combine
import Foundation
import LecternIntents
import LecternKit
import LecternUI
import Network
import RecorderKit

/// One per process, made at launch. The menu bar HUD, the main window and Settings all read it:
/// who is signed in, the upload queue, the recorder and its view model, the global shortcut and
/// the "document ready" notifications. The app stays in the menu bar when its windows close, so
/// this outlives every window.
@MainActor
final class MacServices: ObservableObject {
    enum Session: Equatable {
        case starting, signedOut, signedIn
    }

    static let shared = MacServices()
    static let folderKey = "record_folder_id"
    static let foldersCacheKey = "record_folders"

    @Published private(set) var session: Session = .starting
    @Published private(set) var me: Me?
    @Published private(set) var environment: AppEnvironment
    @Published private(set) var client: LecternClient
    @Published private(set) var uploads: [UploadJob] = []
    /// The signed-in user's folders (cached for an offline launch), for the HUD's picker.
    @Published private(set) var folders: [FolderChoice] = []
    /// Where the next recording goes; nil is the workspace without a folder.
    @Published var recordFolderID: String? {
        didSet {
            UserDefaults.standard.set(recordFolderID, forKey: Self.folderKey)
            updateDraft()
        }
    }
    /// A recording to show once the main window is open (a notification was clicked).
    @Published var pendingRecordingID: String?
    /// The saved shortcut could not be registered (another app has it).
    @Published private(set) var hotKeyError: String?

    let recording: MacRecordingViewModel
    /// The menu bar label's state: apart from this object, so a tick does not redraw the windows.
    let menuBar = MenuBarState()
    let hotKey = GlobalHotKey()
    let notifier = ReadyNotifier()
    let meetings = MeetingWatcher()
    private(set) var uploadQueue: UploadQueue?
    private let recordingSession: RecordingSession
    private let tokenStore: TokenStore
    private let pathMonitor = NWPathMonitor()
    private var networkWasDown = false
    private var uploadWatch: Task<Void, Never>?
    private var subscriptions: Set<AnyCancellable> = []

    private init() {
        let environment = AppEnvironment.current()
        self.environment = environment
        tokenStore = KeychainTokenStore(accessGroup: Self.keychainGroup)
        client = Self.makeClient(environment, store: tokenStore)
        recordingSession = Self.makeRecordingSession()
        recording = MacRecordingViewModel(session: recordingSession)
        recordFolderID = UserDefaults.standard.string(forKey: Self.folderKey)
        folders = Self.cachedFolders()

        recording.onQueued = { [weak self] in self?.notifier.askPermissionOnce() }
        recording.$state.removeDuplicates().sink { [menuBar] state in menuBar.show(state) }
            .store(in: &subscriptions)

        makeUploadQueue()
        notifier.onOpen = { [weak self] id in self?.openRecording(id) }
        notifier.onUnauthorized = { [weak self] in self?.sessionExpired() }
        notifier.onOtherResponse = { [weak self] category, action in self?.meetings.handle(category: category, action: action) }
        notifier.start(client: client)
        meetings.isRecording = { [weak self] in
            guard let state = self?.recording.state else { return false }
            return state.isLive || state == .saving
        }
        meetings.isSignedIn = { [weak self] in self?.session == .signedIn }
        meetings.onStart = { [weak self] in
            // Only from idle: a recording that began after the prompt must not be stopped.
            guard let self, !self.recording.state.isLive, self.recording.state != .saving else { return }
            Task { await self.recording.toggle() }
        }
        hotKey.onPress = { [weak self] in
            guard let self else { return }
            Task { await self.recording.toggle() }
        }
        let combo = HotKeyCombo.load(from: .standard)
        hotKeyError = hotKey.register(combo) ? nil : GlobalHotKey.unavailableText
        Task { await recordingSession.cleanUpAfterLaunch() }

        pathMonitor.pathUpdateHandler = { path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in MacServices.shared.networkChanged(satisfied: satisfied) }
        }
        pathMonitor.start(queue: DispatchQueue(label: "com.qucord.lectern.network"))
    }

    // MARK: - Session

    func start() async {
        if !environment.isFixture, let live = client as? LiveClient {
            await LegacyMigration.run(client: live)
        }
        guard await client.isSignedIn() else {
            forgetSignIn()
            session = .signedOut
            return
        }
        LegacyMigration.markSettled()
        session = .signedIn
        updateDraft()  // the cached workspace: recording works offline
        runUploads()
        await refreshAccount()
    }

    func signedIn(_ me: Me) {
        LegacyMigration.markSettled()
        session = .signedIn
        apply(me)
        runUploads()
        notifier.start(client: client)
        Task { await loadFolders() }
    }

    func signOut() async {
        LegacyMigration.markSettled()
        notifier.reset()  // another account must not poll this one's recordings
        await client.signOut()
        forgetSignIn()
        session = .signedOut
    }

    /// A 401 the client could not refresh.
    func sessionExpired() {
        guard session == .signedIn else { return }
        Task { await signOut() }
    }

    /// Another server: a new client and queue (credentials belong to a server).
    func setServerURL(_ text: String) async -> Bool {
        guard let url = AppEnvironment.validServerURL(text) else { return false }
        if url == environment.serverURL { return true }
        await signOut()
        UserDefaults.standard.set(url.absoluteString, forKey: AppEnvironment.serverURLKey)
        environment = AppEnvironment.current()
        client = Self.makeClient(environment, store: tokenStore)
        makeUploadQueue()
        notifier.start(client: client)
        return true
    }

    /// The account and folders again (the HUD opened, or at launch). Offline: the cached ones
    /// stay.
    func refreshAccount() async {
        guard session == .signedIn else { return }
        do {
            apply(try await client.me())
            await loadFolders()
        } catch APIError.unauthorized {
            sessionExpired()
        } catch {
            // Offline or the server is down: recording still works with the cached workspace.
        }
    }

    private func apply(_ me: Me) {
        self.me = me
        UserDefaults.standard.set(me.personalWorkspaceID, forKey: AppEnvironment.defaultWorkspaceIDKey)
        updateDraft()
    }

    private func forgetSignIn() {
        me = nil
        folders = []
        recordFolderID = nil
        UserDefaults.standard.removeObject(forKey: AppEnvironment.defaultWorkspaceIDKey)
        UserDefaults.standard.removeObject(forKey: Self.foldersCacheKey)
        updateDraft()
    }

    private func loadFolders() async {
        guard let workspaceID = UserDefaults.standard.string(forKey: AppEnvironment.defaultWorkspaceIDKey),
              let list = try? await client.folders(workspaceID: workspaceID) else { return }
        folders = list.map { FolderChoice(id: $0.id, name: $0.name) }
        UserDefaults.standard.set(folders.map { [$0.id, $0.name] }, forKey: Self.foldersCacheKey)
        if let recordFolderID, !folders.contains(where: { $0.id == recordFolderID }) {
            self.recordFolderID = nil  // the folder was deleted
        }
        updateDraft()
    }

    private func updateDraft() {
        guard session == .signedIn, !environment.isFixture,
              let workspaceID = UserDefaults.standard.string(forKey: AppEnvironment.defaultWorkspaceIDKey) else {
            recording.draft = nil
            return
        }
        let folder = folders.first { $0.id == recordFolderID }
        recording.draft = RecordingDraft(workspaceID: workspaceID, folderID: folder?.id, folderName: folder?.name)
    }

    private static func cachedFolders() -> [FolderChoice] {
        let rows = UserDefaults.standard.array(forKey: foldersCacheKey) as? [[String]] ?? []
        return rows.compactMap { $0.count == 2 ? FolderChoice(id: $0[0], name: $0[1]) : nil }
    }

    // MARK: - Windows

    /// A notification was clicked: the menu bar label, which is always on screen, opens the
    /// main window (the HUD opens it itself).
    func openRecording(_ id: String) {
        pendingRecordingID = id
        NSApp.activate()
        menuBar.windowRequest += 1
    }

    /// A recording handed off from the iPhone (only this server's address). SwiftUI already
    /// brought a main window for the activity: no `windowRequest` (it could open a second one).
    func continueHandoff(_ url: URL?) {
        guard let url, case let .recording(id) = parseDeepLink(url, serverHost: environment.serverURL.host) else { return }
        pendingRecordingID = id
        NSApp.activate()
    }

    // MARK: - Shortcut

    /// A new shortcut from Settings. Not saved when it cannot be registered: the old one stays.
    func setHotKey(_ combo: HotKeyCombo) -> Bool {
        let previous = HotKeyCombo.load(from: .standard)
        guard combo.isUsable, hotKey.register(combo) else {
            hotKeyError = hotKey.register(previous) ? nil : GlobalHotKey.unavailableText
            return false
        }
        combo.save(to: .standard)
        hotKeyError = nil
        return true
    }

    /// While Settings listens for a new combination, the current one must not start a recording.
    func suspendHotKey(_ suspended: Bool) {
        if suspended {
            hotKey.unregister()
        } else {
            hotKeyError = hotKey.register(HotKeyCombo.load(from: .standard)) ? nil : GlobalHotKey.unavailableText
        }
    }

    // MARK: - Uploads

    func runUploads() {
        guard session == .signedIn, let uploadQueue else { return }
        Task { await uploadQueue.run() }
    }

    func retryFailedUploads() {
        guard let uploadQueue else { return }
        let failed = uploads.filter { if case .failed = $0.state { true } else { false } }.map(\.id)
        Task {
            for id in failed { try? await uploadQueue.retry(id) }
            await uploadQueue.run()
        }
    }

    func retryUpload(_ id: String) {
        guard let uploadQueue else { return }
        Task {
            try? await uploadQueue.retry(id)
            await uploadQueue.run()
        }
    }

    func removeUpload(_ id: String) {
        guard let uploadQueue else { return }
        Task { try? await uploadQueue.remove(id) }
    }

    /// The recording session's `enqueue`. The queue is looked up now: a server change replaces it.
    func enqueueRecording(_ result: RecordingResult, draft: RecordingDraft) async throws {
        guard let uploadQueue else { throw RecordingError.failed("업로드 대기열을 열지 못했습니다. 녹음 파일은 이 Mac에 남아 있습니다.") }
        let job = try UploadJob.recording(result, draft: draft, containerURL: AppEnvironment.sharedContainerURL())
        try await uploadQueue.enqueue(job)
        Task { await uploadQueue.run() }
    }

    private func networkChanged(satisfied: Bool) {
        if satisfied, networkWasDown { runUploads() }
        networkWasDown = !satisfied
    }

    private func makeUploadQueue() {
        uploadWatch?.cancel()
        uploads = []
        guard let live = client as? LiveClient else {
            uploadQueue = nil
            return
        }
        let container = AppEnvironment.sharedContainerURL()
        let queue = UploadQueue(store: .inContainer(container), transport: LecternUploadTransport(api: live.api), containerURL: container)
        uploadQueue = queue
        uploadWatch = Task { [weak self] in
            self?.jobsChanged(await queue.jobs())
            for await jobs in queue.updates {
                self?.jobsChanged(jobs)
            }
        }
    }

    private func jobsChanged(_ jobs: [UploadJob]) {
        uploads = jobs
        notifier.jobsChanged(jobs)
    }

    // MARK: - Making things

    /// `$(AppIdentifierPrefix)com.qucord.lectern` from the entitlements; nil in unsigned builds.
    private static var keychainGroup: String? {
        guard let prefix = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String, !prefix.isEmpty else { return nil }
        return prefix + "com.qucord.lectern"
    }

    private static func makeClient(_ environment: AppEnvironment, store: TokenStore) -> LecternClient {
        if environment.isFixture { return FixtureClient() }
        return LiveClient(serverURL: environment.serverURL, store: store, platform: "macos", deviceName: Host.current().localizedName)
    }

    /// Recordings are written into the App Group container's `Recordings/`, where the upload
    /// queue reads them. With "회의 소리도 함께 녹음" on, the input is the microphone (left) and the
    /// system audio (right); if the system audio cannot start, the microphone goes on alone.
    private static func makeRecordingSession() -> RecordingSession {
        let directory = AppEnvironment.sharedContainerURL().appendingPathComponent(UploadJob.recordingsFolder, isDirectory: true)
        let activity = RecordingActivityToken()
        let hooks = RecordingHooks(
            requestPermission: {
                switch AVCaptureDevice.authorizationStatus(for: .audio) {
                case .authorized: return true
                case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
                default: return false
                }
            },
            activate: { _ in
                // Playback would go on through the speakers into the recording.
                await MainActor.run { NotificationCenter.default.post(name: PlayerViewModel.pauseAllNotification, object: nil) }
                activity.begin()
            },
            deactivate: { activity.end() }
        )
        return RecordingSession(
            makeRecorder: {
                let mic = EngineAudioInput()
                let input: AudioInput
                if UserDefaults.standard.bool(forKey: MacDefaults.systemAudio) {
                    let dual = DualInput(mic: mic, system: SystemAudioTap(sampleRate: mic.format.sampleRate))
                    dual.onSystemAudioFailed = { _ in
                        Task { @MainActor in MacServices.shared.recording.showNotice(DualInput.micOnlyWarning) }
                    }
                    input = dual
                } else {
                    input = mic
                }
                let recorder = Recorder(input: input, sink: FileAudioSink(), directory: directory)
                mic.onInputLost = { [weak recorder] in
                    Task { await recorder?.handle(.routeLost) }
                }
                return recorder
            },
            activity: NoRecordingActivity(),
            enqueue: { result, draft in
                try await MacServices.shared.enqueueRecording(result, draft: draft)
            },
            hooks: hooks
        )
    }
}

/// What the menu bar item shows. Changes once a second at most while recording.
@MainActor
final class MenuBarState: ObservableObject {
    @Published private(set) var title: String?
    @Published private(set) var accessibilityLabel = "Lectern"
    @Published private(set) var failed = false
    /// Bumped when something outside a view (a notification) asks for the main window.
    @Published var windowRequest = 0

    func show(_ state: MacRecordingState) {
        title = MacRecordingViewModel.menuBarTitle(state)
        accessibilityLabel = MacRecordingViewModel.menuBarAccessibilityLabel(state)
        if case .failed = state { failed = true } else { failed = false }
    }
}

/// A folder in the HUD's picker.
struct FolderChoice: Identifiable, Equatable {
    let id: String
    let name: String
}

/// Keeps the Mac awake and out of App Nap while a recording runs: the app may have no window.
private final class RecordingActivityToken: @unchecked Sendable {
    private let lock = NSLock()
    private var token: NSObjectProtocol?

    func begin() {
        lock.withLock {
            guard token == nil else { return }
            token = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .idleSystemSleepDisabled], reason: "녹음")
        }
    }

    func end() {
        lock.withLock {
            if let token { ProcessInfo.processInfo.endActivity(token) }
            token = nil
        }
    }
}
