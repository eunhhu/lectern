import Foundation
import LecternKit
import os
#if canImport(ActivityKit) && os(iOS)
import ActivityKit
#endif

/// The system's processing Live Activities (ActivityKit on iOS, a fake in tests).
public protocol ProcessingActivityController: Sendable {
    /// The recordings with an activity on screen, oldest first.
    func running() async -> [String]
    /// False when the system refused (activities off, or the app is not in the foreground: then
    /// the server's push-to-start brings one).
    func start(attributes: ProcessingActivityAttributes, state: ProcessingContentState) async -> Bool
    func end(recordingID: String) async
    func endAll() async
}

/// Starts a processing activity when an upload finishes and tells the server where to push its
/// updates: each activity's push token (once per change) and its end. At most five at a time:
/// the oldest ends to make room.
public actor ProcessingActivityCoordinator {
    public static let maxActivities = 5

    private let controller: ProcessingActivityController
    private let api: PushAPI
    private let deviceID: String
    private var sentTokens: [String: String] = [:]
    private static let log = Logger(subsystem: "com.qucord.lectern", category: "push")

    public init(controller: ProcessingActivityController, api: PushAPI, deviceID: String) {
        self.controller = controller
        self.api = api
        self.deviceID = deviceID
    }

    /// An upload just finished (its job turned `done`).
    public func uploadFinished(recordingID: String, title: String) async {
        var running = await controller.running()
        guard !running.contains(recordingID) else { return }
        while running.count >= Self.maxActivities {
            await controller.end(recordingID: running.removeFirst())
        }
        let attributes = ProcessingActivityAttributes(recordingID: recordingID, title: title)
        if await !controller.start(attributes: attributes, state: .uploaded(recordingID: recordingID)) {
            Self.log.info("push: no processing activity started here; the server's push-to-start may bring one")
        }
    }

    /// An activity's push token, from ActivityKit (also for activities the server started).
    public func pushTokenChanged(recordingID: String, token: String) async {
        guard sentTokens[recordingID] != token else { return }
        do {
            try await api.setLiveActivity(recordingID: recordingID, deviceID: deviceID, pushToken: token)
            sentTokens[recordingID] = token
        } catch APIError.server(status: 501, _, _) {
            // Push is off on this server.
        } catch {
            Self.log.error("push: sending the activity token failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// The activity ended or was dismissed: the server stops pushing to it.
    public func activityEnded(recordingID: String) async {
        guard sentTokens.removeValue(forKey: recordingID) != nil else { return }
        try? await api.endLiveActivity(recordingID: recordingID, deviceID: deviceID)
    }

    /// Signed out: no titles left on the Lock Screen.
    public func signOut() async {
        sentTokens = [:]
        await controller.endAll()
    }
}

#if canImport(ActivityKit) && os(iOS)
/// `Activity<ProcessingActivityAttributes>`, push updates (`pushType: .token`).
public struct SystemProcessingActivity: ProcessingActivityController {
    public init() {}

    private static var live: [Activity<ProcessingActivityAttributes>] {
        Activity<ProcessingActivityAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
    }

    public func running() async -> [String] {
        Self.live.map(\.attributes.recordingID)
    }

    public func start(attributes: ProcessingActivityAttributes, state: ProcessingContentState) async -> Bool {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
        do {
            _ = try Activity.request(attributes: attributes, content: ActivityContent(state: state, staleDate: nil), pushType: .token)
            return true
        } catch {
            return false
        }
    }

    public func end(recordingID: String) async {
        for activity in Self.live where activity.attributes.recordingID == recordingID {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    public func endAll() async {
        for activity in Activity<ProcessingActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}

/// Follows every processing activity, the app's own and those the server started with a
/// push-to-start: their push tokens and their end go to the coordinator, and the push-to-start
/// token goes to the device registration.
public enum ProcessingActivityObserver {
    public static func start(coordinator: ProcessingActivityCoordinator, registration: PushRegistration) -> Task<Void, Never> {
        Task {
            await withTaskGroup(of: Void.self) { group in
                group.addTask {
                    for await token in Activity<ProcessingActivityAttributes>.pushToStartTokenUpdates {
                        await registration.pushToStartTokenChanged(token)
                    }
                }
                group.addTask {
                    // Those already on screen (from before this launch), then each new one.
                    for activity in Activity<ProcessingActivityAttributes>.activities {
                        watch(activity, coordinator: coordinator)
                    }
                    for await activity in Activity<ProcessingActivityAttributes>.activityUpdates {
                        // The server's push-to-start can race the app's own activity (its token not
                        // sent yet): keep the one on screen, end the newcomer without telling the
                        // server (it would stop pushing to the kept one).
                        if hasTwin(activity) {
                            Task { await activity.end(nil, dismissalPolicy: .immediate) }
                            continue
                        }
                        watch(activity, coordinator: coordinator)
                    }
                }
            }
        }
    }

    private static func hasTwin(_ activity: Activity<ProcessingActivityAttributes>) -> Bool {
        Activity<ProcessingActivityAttributes>.activities.contains { other in
            other.id != activity.id && other.attributes.recordingID == activity.attributes.recordingID
                && (other.activityState == .active || other.activityState == .stale)
        }
    }

    private static func watch(_ activity: Activity<ProcessingActivityAttributes>, coordinator: ProcessingActivityCoordinator) {
        let recordingID = activity.attributes.recordingID
        Task {
            for await token in activity.pushTokenUpdates {
                await coordinator.pushTokenChanged(recordingID: recordingID, token: PushRegistration.hex(token))
            }
        }
        Task {
            for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
                await coordinator.activityEnded(recordingID: recordingID)
                return
            }
        }
    }
}
#endif
