import SwiftUI

@main
struct LecternApp: App {
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
            if phase == .active { app.resumeUploads() }
        }
    }
}
