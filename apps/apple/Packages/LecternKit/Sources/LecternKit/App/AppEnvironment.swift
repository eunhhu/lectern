import Foundation

/// How the app was started: which server, and whether it runs on fixtures (no server).
public struct AppEnvironment: Sendable, Equatable {
    /// The user's server address (Settings › 서버 주소), in UserDefaults.
    public static let serverURLKey = "lectern_server_url"
    /// `-LECTERN_FIXTURE 1` (launch argument) or `LECTERN_FIXTURE=1` (environment).
    public static let fixtureFlag = "LECTERN_FIXTURE"
    /// App Group `UserDefaults`: the workspace the intents and the share extension use, written
    /// by the app at sign-in (absent: nobody is signed in).
    public static let defaultWorkspaceIDKey = "default_workspace_id"
    public static let appGroup = "group.com.qucord.lectern"
    static let fallbackServerURL = URL(string: "http://localhost:18775")!

    public let serverURL: URL
    public let isFixture: Bool

    /// The user's address wins over the build's (`LecternServerURL` in Info.plist).
    public init(arguments: [String], environment: [String: String], savedServerURL: String?, infoPlistServerURL: String?) {
        serverURL = savedServerURL.flatMap(Self.validServerURL)
            ?? infoPlistServerURL.flatMap(Self.validServerURL)
            ?? Self.fallbackServerURL
        let flagged: Bool = {
            if let value = environment[Self.fixtureFlag], Self.isOn(value) { return true }
            guard let index = arguments.firstIndex(of: "-\(Self.fixtureFlag)"), index + 1 < arguments.count else { return false }
            return Self.isOn(arguments[index + 1])
        }()
        isFixture = flagged
    }

    public static func current(defaults: UserDefaults = .standard, bundle: Bundle = .main, processInfo: ProcessInfo = .processInfo) -> AppEnvironment {
        AppEnvironment(
            arguments: processInfo.arguments,
            environment: processInfo.environment,
            savedServerURL: defaults.string(forKey: serverURLKey),
            infoPlistServerURL: bundle.object(forInfoDictionaryKey: "LecternServerURL") as? String
        )
    }

    /// An http(s) address with a host, without a trailing slash; nil otherwise.
    public static func validServerURL(_ text: String) -> URL? {
        var trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty
        else { return nil }
        return url
    }

    /// The App Group folder the app and its extensions share (the upload queue lives there).
    /// Unsigned builds have no App Group: then the app's own Application Support folder.
    public static func sharedContainerURL(fileManager: FileManager = .default) -> URL {
        if let group = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
            return group
        }
        let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Lectern", isDirectory: true)
        try? fileManager.createDirectory(at: support, withIntermediateDirectories: true)
        return support
    }

    private static func isOn(_ value: String) -> Bool {
        ["1", "yes", "true"].contains(value.lowercased())
    }
}
