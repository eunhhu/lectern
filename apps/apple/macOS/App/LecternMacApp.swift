import AppKit
import LecternKit
import LecternUI
import SwiftUI

/// The menu bar recorder, the main window and Settings. The app has a Dock icon
/// (`LSUIElement` false); closing the main window leaves it running in the menu bar, and a
/// recording goes on.
@main
struct LecternMacApp: App {
    @NSApplicationDelegateAdaptor(MacAppDelegate.self) private var delegate
    @StateObject private var services = MacServices.shared

    var body: some Scene {
        WindowGroup("Lectern", id: MainWindowOpener.id) {
            MainWindow()
                .environmentObject(services)
                // The open main window takes the activity (SwiftUI would otherwise make a new one);
                // with none open, SwiftUI opens one for it.
                .handlesExternalEvents(preferring: [RecordingHandoff.activityType], allowing: ["*"])
                .onContinueUserActivity(RecordingHandoff.activityType) { activity in
                    services.continueHandoff(activity.webpageURL)
                }
        }
        .commands { LecternCommands() }

        MenuBarExtra {
            MenuBarHUD(services: services, recording: services.recording)
        } label: {
            MenuBarLabel(state: services.menuBar)
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView()
                .environmentObject(services)
        }
    }
}

@MainActor
final class MacAppDelegate: NSObject, NSApplicationDelegate {
    /// Before launch finishes, so the notification delegate is set when a click on a
    /// notification is what launched the app.
    func applicationWillFinishLaunching(_ notification: Notification) {
        _ = MacServices.shared
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { await MacServices.shared.start() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    /// Quitting while recording (종료, ⌘Q, logging out) stops first, so the file is finished
    /// and in the upload queue before the process ends.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        let recording = MacServices.shared.recording
        guard recording.state.isLive || recording.state == .saving else { return .terminateNow }
        Task { @MainActor in
            if recording.state.isLive { await recording.toggle() }
            for _ in 0..<100 where recording.state == .saving {
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}
