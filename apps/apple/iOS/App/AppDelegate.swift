import os
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    private static let log = Logger(subsystem: "com.qucord.lectern", category: "push")

    /// The background upload session finished its work while the app was suspended or quit.
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        MainActor.assumeIsolated {
            AppServices.shared.handleBackgroundSessionEvents(identifier: identifier, completion: completionHandler)
        }
    }

    /// The APNs token (after `registerForRemoteNotifications`): to the server's device list.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        MainActor.assumeIsolated {
            AppServices.shared.surfaces.apnsTokenArrived(deviceToken)
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Self.log.error("push: registration failed: \(error.localizedDescription, privacy: .public)")
    }
}
