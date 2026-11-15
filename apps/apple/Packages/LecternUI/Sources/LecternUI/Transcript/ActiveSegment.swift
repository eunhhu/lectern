import Foundation

/// The array position of the last segment whose start is at or before `positionMs`, or nil
/// before the first one. `startsMs` is in transcript order (ascending), so this is a binary
/// search; the player asks about ten times a second.
public func activeSegmentIndex(startsMs: [Int], positionMs: Int) -> Int? {
    var lo = 0
    var hi = startsMs.count - 1
    var found: Int?
    while lo <= hi {
        let mid = (lo + hi) / 2
        if startsMs[mid] <= positionMs {
            found = mid
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return found
}

/// When the transcript follows playback. A scroll the user makes stops following until five
/// seconds after it comes to rest (not after it starts: a long drag must not be pulled back).
public enum AutoScrollPolicy {
    public static let pause: TimeInterval = 5

    public static func shouldFollow(now: Date, userScrolling: Bool, userScrollEndedAt: Date?) -> Bool {
        if userScrolling { return false }
        guard let ended = userScrollEndedAt else { return true }
        return now.timeIntervalSince(ended) >= pause
    }
}
