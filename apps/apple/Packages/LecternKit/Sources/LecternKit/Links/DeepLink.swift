import Foundation

/// A screen of the app an address points to.
public enum DeepLink: Equatable, Sendable {
    case recording(id: String)
    case library
    case settings
    /// A share link (`/s/<token>`): no screen in the app yet; Safari opens it.
    case share(token: String)
    /// A workspace invitation (`/app/invite?token=`): no screen in the app yet; Safari opens it.
    case invite(token: String)
}

/// Handoff of an open recording between the Mac and the iPhone (`NSUserActivityTypes` in both
/// apps). The web address lets a device without the app continue in Safari.
public enum RecordingHandoff {
    public static let activityType = "com.qucord.lectern.recording"

    public static func webpageURL(server: URL, recordingID: String) -> URL {
        server.appendingPathComponent("app").appendingPathComponent("recordings").appendingPathComponent(recordingID)
    }
}

/// `lectern://recordings/<id>`, `lectern://library`, `lectern://settings`, and the server's
/// `/app`, `/app/library`, `/app/settings`, `/app/recordings/<id>`, `/app/invite?token=…`,
/// `/s/<token>` (only on `serverHost`). Ids and tokens are `[A-Za-z0-9_-]{1,128}`. Anything else
/// is nil: the app leaves it to Safari.
public func parseDeepLink(_ url: URL, serverHost: String?) -> DeepLink? {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false), let scheme = components.scheme?.lowercased() else { return nil }
    switch scheme {
    case "lectern":
        // lectern://recordings/<id>: the host is the first part.
        var parts = pathParts(components.percentEncodedPath)
        if let host = components.host, !host.isEmpty { parts.insert(host, at: 0) }
        switch parts.count {
        case 1 where parts[0] == "library": return .library
        case 1 where parts[0] == "settings": return .settings
        case 2 where parts[0] == "recordings": return validID(parts[1]).map { .recording(id: $0) }
        default: return nil
        }
    case "https", "http":
        guard let serverHost, let host = components.host, host.lowercased() == serverHost.lowercased() else { return nil }
        let parts = pathParts(components.percentEncodedPath)
        switch parts.count {
        case 1 where parts[0] == "app": return .library
        case 2 where parts[0] == "app" && parts[1] == "library": return .library
        case 2 where parts[0] == "app" && parts[1] == "settings": return .settings
        case 2 where parts[0] == "app" && parts[1] == "invite":
            let token = components.queryItems?.first { $0.name == "token" }?.value
            return token.flatMap(validID).map { .invite(token: $0) }
        case 2 where parts[0] == "s": return validID(parts[1]).map { .share(token: $0) }
        case 3 where parts[0] == "app" && parts[1] == "recordings": return validID(parts[2]).map { .recording(id: $0) }
        default: return nil
        }
    default:
        return nil
    }
}

/// The decoded path parts, without empty ones (a trailing slash).
private func pathParts(_ percentEncodedPath: String) -> [String] {
    percentEncodedPath.split(separator: "/", omittingEmptySubsequences: true).map { part in
        String(part).removingPercentEncoding ?? String(part)
    }
}

private func validID(_ value: String) -> String? {
    guard (1...128).contains(value.count),
          value.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }) else { return nil }
    return value
}
