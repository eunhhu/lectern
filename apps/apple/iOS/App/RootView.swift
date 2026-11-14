import LecternKit
import LecternUI
import SwiftUI
import UIKit

/// The app's state: which server and client, whether someone is signed in, the upload queue.
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
    private(set) var uploadQueue: UploadQueue?
    private var uploadWatch: Task<Void, Never>?
    private let tokenStore: TokenStore

    init() {
        let environment = AppEnvironment.current()
        self.environment = environment
        tokenStore = KeychainTokenStore(accessGroup: Self.keychainGroup)
        client = Self.makeClient(environment, store: tokenStore)
        if !environment.isFixture { makeUploadQueue() }
    }

    /// `$(AppIdentifierPrefix)com.qucord.lectern` from the entitlements; nil in unsigned builds.
    private static var keychainGroup: String? {
        guard let prefix = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String, !prefix.isEmpty else { return nil }
        return prefix + "com.qucord.lectern"
    }

    private static func makeClient(_ environment: AppEnvironment, store: TokenStore) -> LecternClient {
        if environment.isFixture { return FixtureClient() }
        return LiveClient(serverURL: environment.serverURL, store: store, platform: "ios", deviceName: UIDevice.current.name)
    }

    func start() async {
        if await client.isSignedIn() {
            me = try? await client.me()
            session = .signedIn
            resumeUploads()
        } else {
            session = .signedOut
        }
    }

    func signedIn(_ me: Me) {
        self.me = me
        session = .signedIn
        resumeUploads()
    }

    func signOut() async {
        await client.signOut()
        me = nil
        session = .signedOut
    }

    /// Called on a 401 the client could not refresh: back to the sign-in screen.
    func sessionExpired() {
        Task { await signOut() }
    }

    /// Another server: a new client (credentials belong to a server, so this signs out first).
    func setServerURL(_ text: String) async -> Bool {
        guard let url = AppEnvironment.validServerURL(text) else { return false }
        if url == environment.serverURL { return true }
        await client.signOut()
        UserDefaults.standard.set(url.absoluteString, forKey: AppEnvironment.serverURLKey)
        environment = AppEnvironment.current()
        client = Self.makeClient(environment, store: tokenStore)
        makeUploadQueue()
        me = nil
        session = .signedOut
        return true
    }

    func resumeUploads() {
        guard session == .signedIn, let uploadQueue else { return }
        Task { await uploadQueue.run() }
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

    private func makeUploadQueue() {
        uploadWatch?.cancel()
        guard let live = client as? LiveClient else {
            uploadQueue = nil
            return
        }
        let container = AppEnvironment.sharedContainerURL()
        let queue = UploadQueue(store: .inContainer(container), transport: LecternUploadTransport(api: live.api), containerURL: container)
        uploadQueue = queue
        uploadWatch = Task { [weak self] in
            self?.uploads = await queue.jobs()
            for await jobs in queue.updates {
                self?.uploads = jobs
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
