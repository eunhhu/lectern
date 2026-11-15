import Foundation
import os

/// What the server is told about this device (`UpsertPushDeviceRequest`).
public struct PushDeviceRegistration: Equatable, Sendable {
    public var apnsToken: String
    public var pushToStartToken: String?
    public var name: String?
    public var appVersion: String?

    public init(apnsToken: String, pushToStartToken: String?, name: String?, appVersion: String?) {
        self.apnsToken = apnsToken
        self.pushToStartToken = pushToStartToken
        self.name = name
        self.appVersion = appVersion
    }
}

/// The push calls (`LecternAPI` in the app, a fake in tests).
public protocol PushAPI: Sendable {
    func upsertPushDevice(deviceID: String, registration: PushDeviceRegistration) async throws
    func deletePushDevice(deviceID: String) async throws
    func setLiveActivity(recordingID: String, deviceID: String, pushToken: String) async throws
    func endLiveActivity(recordingID: String, deviceID: String) async throws
}

/// Keeps the server's `push_device` row for this iPhone current: the APNs token and the Live
/// Activity push-to-start token, sent once per change (the last value the server accepted is
/// remembered, in memory). A server with push off answers 501: nothing is said. Sign-out deletes
/// the row before the credentials go (the delete needs them).
public actor PushRegistration {
    public nonisolated let deviceID: String
    private let api: PushAPI
    private let name: String?
    private let appVersion: String?
    private var apnsToken: String?
    private var pushToStartToken: String?
    private var lastSent: PushDeviceRegistration?
    private static let log = Logger(subsystem: "com.qucord.lectern", category: "push")

    public init(api: PushAPI, deviceID: String, name: String?, appVersion: String?) {
        self.api = api
        self.deviceID = deviceID
        self.name = name
        self.appVersion = appVersion
    }

    /// From `didRegisterForRemoteNotificationsWithDeviceToken`.
    public func apnsTokenChanged(_ token: Data) async {
        await apnsTokenChanged(Self.hex(token))
    }

    public func apnsTokenChanged(_ hex: String) async {
        apnsToken = hex
        await sendIfChanged()
    }

    /// From `Activity<…>.pushToStartTokenUpdates`. Held until the APNs token exists (the server
    /// requires it).
    public func pushToStartTokenChanged(_ token: Data) async {
        await pushToStartTokenChanged(Self.hex(token))
    }

    public func pushToStartTokenChanged(_ hex: String) async {
        pushToStartToken = hex
        await sendIfChanged()
    }

    /// After a sign-in: the new account gets this device too.
    public func signedIn() async {
        await sendIfChanged()
    }

    /// Deletes the device row (bounded by `timeout`: an unreachable server must not hold the
    /// sign-out), then clears the credentials. A failed delete does not stop the sign-out.
    public func signOut(timeout: TimeInterval = 5, clearCredentials: @Sendable () async -> Void) async {
        let api = api
        let deviceID = deviceID
        await withTaskGroup(of: Void.self) { group in
            group.addTask { try? await api.deletePushDevice(deviceID: deviceID) }
            group.addTask { try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000)) }
            await group.next()
            group.cancelAll()
        }
        lastSent = nil
        await clearCredentials()
    }

    public static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    private func sendIfChanged() async {
        guard let apnsToken else { return }
        let registration = PushDeviceRegistration(apnsToken: apnsToken, pushToStartToken: pushToStartToken, name: name, appVersion: appVersion)
        guard registration != lastSent else { return }
        do {
            try await api.upsertPushDevice(deviceID: deviceID, registration: registration)
            lastSent = registration
        } catch APIError.server(status: 501, _, _) {
            // Push is off on this server: nothing to tell the user.
        } catch {
            Self.log.error("push: registering the device failed: \(String(describing: error), privacy: .public)")
        }
    }
}
