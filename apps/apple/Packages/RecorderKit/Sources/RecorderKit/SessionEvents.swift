import Foundation

/// The audio session's notifications as recorder events, from the raw numbers in their
/// `userInfo` (the same values on every platform, so this is tested on macOS too).
///
/// - `AVAudioSessionInterruptionTypeKey`: 1 began, 0 ended.
/// - `AVAudioSessionInterruptionOptionKey`: bit 1 = should resume.
/// - `AVAudioSessionRouteChangeReasonKey`: 1 new device available, 2 old device unavailable.
public enum SessionEvents {
    public static func interruption(type: UInt, options: UInt) -> RecorderEvent? {
        switch type {
        case 1: .interruptionBegan
        case 0: .interruptionEnded(shouldResume: options & 1 != 0)
        default: nil
        }
    }

    /// Only a device going away or coming back matters; category changes and overrides do not.
    public static func routeChange(reason: UInt) -> RecorderEvent? {
        switch reason {
        case 2: .routeLost
        case 1: .routeRestored
        default: nil
        }
    }
}
