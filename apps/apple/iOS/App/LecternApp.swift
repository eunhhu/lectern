import SwiftUI
import UIKit

@main
struct LecternApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var app = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Before any scene: an intent (the control, Siri) may wake the app with none.
        _ = AppServices.shared
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .task { await app.start() }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: app.resumeUploads()
            case .background: AppServices.shared.handOffUploads()
            default: break
            }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    /// The background upload session finished its work while the app was suspended or quit.
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        MainActor.assumeIsolated {
            AppServices.shared.handleBackgroundSessionEvents(identifier: identifier, completion: completionHandler)
        }
    }
}
