import Foundation
import os
#if canImport(ActivityKit) && os(iOS)
import ActivityKit
#endif

/// The Live Activity of the recording in progress (at most one). The session calls it only when
/// the state really changes, never for levels: the system limits how often an activity updates.
public protocol RecordingActivityController: Sendable {
    /// False when Live Activities are off (Settings) or the system refused one: the recording
    /// goes on without an activity, and `update`/`end` are not called for it.
    func start(attributes: RecordingActivityAttributes, state: RecordingActivityAttributes.ContentState) async -> Bool
    func update(state: RecordingActivityAttributes.ContentState) async
    /// Shows `state` and removes the activity after `dismissAfter` seconds (0: at once).
    func end(state: RecordingActivityAttributes.ContentState, dismissAfter: TimeInterval) async
    /// At launch: activities left by a run that ended without a stop (a crash).
    func endLeftovers() async
}

#if canImport(ActivityKit) && os(iOS)
/// `Activity<RecordingActivityAttributes>`, local updates only (no push token: the processing
/// activity of P6-A11 is a separate one).
public final class SystemRecordingActivity: RecordingActivityController, @unchecked Sendable {
    private let lock = NSLock()
    private var activity: Activity<RecordingActivityAttributes>?
    private static let log = Logger(subsystem: "com.qucord.lectern", category: "recording")

    public init() {}

    public func start(attributes: RecordingActivityAttributes, state: RecordingActivityAttributes.ContentState) async -> Bool {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
        do {
            let started = try Activity.request(attributes: attributes, content: ActivityContent(state: state, staleDate: nil), pushType: nil)
            lock.withLock { activity = started }
            return true
        } catch {
            Self.log.error("recording: live activity refused: \(error.localizedDescription, privacy: .public)")
            return false
        }
    }

    public func update(state: RecordingActivityAttributes.ContentState) async {
        guard let current = lock.withLock({ activity }) else { return }
        await current.update(ActivityContent(state: state, staleDate: nil))
    }

    public func end(state: RecordingActivityAttributes.ContentState, dismissAfter: TimeInterval) async {
        let current = lock.withLock { () -> Activity<RecordingActivityAttributes>? in
            defer { activity = nil }
            return activity
        }
        guard let current else { return }
        let policy: ActivityUIDismissalPolicy = dismissAfter > 0 ? .after(Date().addingTimeInterval(dismissAfter)) : .immediate
        await current.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: policy)
    }

    public func endLeftovers() async {
        for leftover in Activity<RecordingActivityAttributes>.activities {
            await leftover.end(nil, dismissalPolicy: .immediate)
        }
    }
}
#endif
