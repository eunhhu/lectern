import LecternIntents
import LecternKit
import LecternUI
import SwiftUI

/// The app's state for the screens: who is signed in, the upload queue's entries, the recording
/// in progress. What lives for the whole process is in `AppServices`.
@MainActor
final class AppModel: ObservableObject {
    enum Session: Equatable {
        case starting, signedOut, signedIn
    }

    @Published private(set) var session: Session = .starting
    @Published private(set) var me: Me?
    @Published private(set) var environment: AppEnvironment
    @Published private(set) var client: LecternClient
    @Published private(set) var uploads: [UploadJob] = []
    /// The recording in progress, wherever it was started (here, the control, Siri).
    @Published private(set) var recording: RecordingActivityAttributes.ContentState?
    private let services: AppServices
    private var uploadWatch: Task<Void, Never>?
    private var recordingWatch: Task<Void, Never>?

    init(services: AppServices? = nil) {
        let services = services ?? .shared
        self.services = services
        environment = services.environment
        client = services.client
        watchUploads()
        watchRecording()
    }

    /// Nil in fixture mode (no queue to put a recording in).
    var recordingSession: RecordingSession? { services.recordingSession }

    func start() async {
        if await client.isSignedIn() {
            me = try? await client.me()
            if let me { services.remember(me) }
            session = .signedIn
            resumeUploads()
        } else {
            session = .signedOut
        }
    }

    func signedIn(_ me: Me) {
        self.me = me
        services.remember(me)
        session = .signedIn
        resumeUploads()
    }

    func signOut() async {
        await services.signOut()
        me = nil
        session = .signedOut
    }

    /// Called on a 401 the client could not refresh: back to the sign-in screen.
    func sessionExpired() {
        Task { await signOut() }
    }

    /// Another server: a new client (credentials belong to a server, so this signs out first).
    func setServerURL(_ text: String) async -> Bool {
        guard await services.setServerURL(text) else { return false }
        environment = services.environment
        client = services.client
        watchUploads()
        me = nil
        session = .signedOut
        return true
    }

    func resumeUploads() {
        guard session == .signedIn else { return }
        services.runUploads()
    }

    func retryUpload(_ id: String) {
        guard let queue = services.uploadQueue else { return }
        Task {
            try? await queue.retry(id)
            await queue.run()
        }
    }

    func removeUpload(_ id: String) {
        guard let queue = services.uploadQueue else { return }
        Task { try? await queue.remove(id) }
    }

    private func watchUploads() {
        uploadWatch?.cancel()
        uploads = []
        guard let queue = services.uploadQueue else { return }
        uploadWatch = Task { [weak self] in
            self?.uploads = await queue.jobs()
            for await jobs in queue.updates {
                self?.uploads = jobs
            }
        }
    }

    private func watchRecording() {
        guard let recordingSession = services.recordingSession else { return }
        let states = recordingSession.states
        recordingWatch = Task { [weak self] in
            for await state in states {
                self?.recording = state.isLive ? state : nil
            }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var app: AppModel

    var body: some View {
        Group {
            switch app.session {
            case .starting:
                ProgressView()
                    .accessibilityLabel("불러오는 중")
            case .signedOut:
                LoginScreen()
            case .signedIn:
                LibraryScreen()
            }
        }
        .background(Theme.canvas)
    }
}
