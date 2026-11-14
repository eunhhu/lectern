import AppIntents
import LecternIntents
import SwiftUI
import WidgetKit

@main
struct LecternWidgetsBundle: WidgetBundle {
    var body: some Widget {
        RecordingLiveActivity()
        RecordingControl()
    }
}

/// The recording intents live in the LecternIntents package; the Live Activity's buttons and the
/// control need their metadata in this extension too (they run in the app's process).
struct LecternWidgetsIntents: AppIntentsPackage {
    static var includedPackages: [any AppIntentsPackage.Type] { [LecternIntentsPackage.self] }
}
