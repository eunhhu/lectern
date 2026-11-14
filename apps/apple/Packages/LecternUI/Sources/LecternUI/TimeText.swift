import Foundation

/// Times on screen and for VoiceOver. Pure, so the labels are tested.
public enum TimeText {
    /// "0:59", "12:05", "1:02:05".
    public static func timestamp(_ ms: Int) -> String {
        let total = max(0, ms / 1000)
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    /// Spoken form: "59초", "12분 5초", "1시간 2분 5초" (zero parts left out, like the web).
    public static func spoken(_ ms: Int) -> String {
        let total = max(0, ms / 1000)
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        var parts: [String] = []
        if h > 0 { parts.append("\(h)시간") }
        if m > 0 { parts.append("\(m)분") }
        if s > 0 || parts.isEmpty { parts.append("\(s)초") }
        return parts.joined(separator: " ")
    }
}
