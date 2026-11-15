import CoreSpotlight
import LecternIntents
import LecternKit
import SwiftUI
import UIKit

@main
struct LecternApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var app = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Before any scene: an intent (the control, Siri) may wake the app with none, and a tap
        // on an alert needs the notification delegate set.
        _ = AppServices.shared
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .task { await app.start() }
                .onOpenURL { url in app.open(url) }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { app.open(url) }
                }
                .onContinueUserActivity(RecordingHandoff.activityType) { activity in
                    if let url = activity.webpageURL { app.open(url) }
                }
                .onContinueUserActivity(CSSearchableItemActionType) { activity in
                    if let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String {
                        LinkRouter.shared.open(.recording(id: id))
                    }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: app.becameActive()
            case .background: AppServices.shared.handOffUploads()
            default: break
            }
        }
    }
}
