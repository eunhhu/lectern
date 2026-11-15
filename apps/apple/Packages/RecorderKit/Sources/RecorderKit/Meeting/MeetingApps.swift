import Foundation

/// A video-call app whose launch can prompt "record this meeting?".
public struct MeetingApp: Sendable, Equatable {
    public let bundleID: String
    public let name: String

    public init(bundleID: String, name: String) {
        self.bundleID = bundleID
        self.name = name
    }
}

/// The apps watched. Browser meetings (Meet) are not: a browser launching says nothing.
public let knownMeetingApps: [MeetingApp] = [
    MeetingApp(bundleID: "us.zoom.xos", name: "Zoom"),
    MeetingApp(bundleID: "com.microsoft.teams2", name: "Microsoft Teams"),
    MeetingApp(bundleID: "com.microsoft.teams", name: "Microsoft Teams"),
    MeetingApp(bundleID: "com.cisco.webexmeetingsapp", name: "Webex"),
    MeetingApp(bundleID: "Cisco-Systems.Spark", name: "Webex"),
    MeetingApp(bundleID: "com.apple.FaceTime", name: "FaceTime"),
]

public func meetingApp(bundleID: String) -> MeetingApp? {
    knownMeetingApps.first { $0.bundleID == bundleID }
}

/// Whether a launched app should prompt: only when the prompt is on, nothing is recording, the
/// app is a known meeting app, and that app has not prompted within the cooldown. Never starts
/// a recording by itself.
public struct MeetingPrompter: Sendable {
    public let cooldownSeconds: Double
    private var lastPrompt: [String: Date] = [:]

    public init(cooldownSeconds: Double = 1800) {
        self.cooldownSeconds = cooldownSeconds
    }

    public mutating func shouldPrompt(launchedBundleID: String, isRecording: Bool, enabled: Bool, now: Date) -> MeetingApp? {
        guard enabled, !isRecording, let app = meetingApp(bundleID: launchedBundleID) else { return nil }
        if let last = lastPrompt[app.bundleID], now.timeIntervalSince(last) < cooldownSeconds { return nil }
        lastPrompt[app.bundleID] = now
        return app
    }
}
