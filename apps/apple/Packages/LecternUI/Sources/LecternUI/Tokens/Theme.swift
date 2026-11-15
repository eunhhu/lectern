import SwiftUI

/// The design tokens as the app's palette and type ramp. Screen code uses these names; it never
/// writes a hex color or a font size. Every color follows light and dark mode (the tokens'
/// `Color(lecternLight:dark:)`).
public enum Theme {
    private typealias C = LecternTokens.Colors

    public static let canvas = C.bgCanvas
    public static let panel = C.bgPanel
    public static let raised = C.bgRaised
    public static let hover = C.bgHover
    public static let active = C.bgActive
    public static let selected = C.bgSelected
    public static let separator = C.borderSubtle
    public static let border = C.borderDefault
    public static let focus = C.borderFocus
    public static let textPrimary = C.textPrimary
    public static let textSecondary = C.textSecondary
    public static let textTertiary = C.textTertiary
    public static let accent = C.accentSolid
    public static let accentText = C.accentFg
    public static let onAccent = C.textOnSolid

    /// Status colors: text, a tinted background, and a border.
    public struct Tone: Sendable {
        public let text: Color
        public let background: Color
        public let border: Color
    }

    public enum ToneName: CaseIterable, Sendable {
        case danger, severe, attention, info, success
    }

    public static func tone(_ name: ToneName) -> Tone {
        switch name {
        case .danger: Tone(text: C.statusDangerFg, background: C.statusDangerSubtle, border: C.statusDangerBorder)
        case .severe: Tone(text: C.statusSevereFg, background: C.statusSevereSubtle, border: C.statusSevereBorder)
        case .attention: Tone(text: C.statusAttentionFg, background: C.statusAttentionSubtle, border: C.statusAttentionBorder)
        case .info: Tone(text: C.statusInfoFg, background: C.statusInfoSubtle, border: C.statusInfoBorder)
        case .success: Tone(text: C.statusSuccessFg, background: C.statusSuccessSubtle, border: C.statusSuccessBorder)
        }
    }

    /// Every color here by name (the theme test resolves each in both schemes).
    static var all: [(name: String, color: Color)] {
        var colors: [(String, Color)] = [
            ("canvas", canvas), ("panel", panel), ("raised", raised), ("hover", hover), ("active", active),
            ("selected", selected), ("separator", separator), ("border", border), ("focus", focus),
            ("textPrimary", textPrimary), ("textSecondary", textSecondary), ("textTertiary", textTertiary),
            ("accent", accent), ("accentText", accentText), ("onAccent", onAccent),
        ]
        for name in ToneName.allCases {
            let tone = tone(name)
            colors += [("\(name).text", tone.text), ("\(name).background", tone.background), ("\(name).border", tone.border)]
        }
        return colors
    }

    /// The document's widest line (reading comfort), centered beyond it.
    public static let readingWidth: CGFloat = 720
    /// The smallest tappable size (Apple HIG: 44 pt).
    public static let minTapTarget: CGFloat = LecternTokens.Size.rowDefault
    public static let activeBarWidth: CGFloat = LecternTokens.Space.s4 - 1
}

/// A text role from the tokens, scaled with Dynamic Type relative to a system text style.
public enum TextRole: CaseIterable, Sendable {
    case caption, body, label, title, heading, display, reading, mono

    public var style: LecternTextStyle {
        switch self {
        case .caption: LecternTokens.TextStyles.caption
        case .body: LecternTokens.TextStyles.body
        case .label: LecternTokens.TextStyles.label
        case .title: LecternTokens.TextStyles.title
        case .heading: LecternTokens.TextStyles.heading
        case .display: LecternTokens.TextStyles.display
        case .reading: LecternTokens.TextStyles.reading
        case .mono: LecternTokens.TextStyles.mono
        }
    }

    /// The system style whose Dynamic Type curve this role follows.
    public var relativeTo: Font.TextStyle {
        switch self {
        case .caption: .caption
        case .body, .reading: .body
        case .label: .subheadline
        case .title: .headline
        case .heading: .title3
        case .display: .largeTitle
        case .mono: .footnote
        }
    }
}

/// `Font.system(size:weight:)` has no `relativeTo:`, so the size goes through `@ScaledMetric`.
struct ScaledTextStyle: ViewModifier {
    private let style: LecternTextStyle
    @ScaledMetric private var size: CGFloat

    init(_ role: TextRole) {
        style = role.style
        _size = ScaledMetric(wrappedValue: role.style.size, relativeTo: role.relativeTo)
    }

    func body(content: Content) -> some View {
        content
            .font(.system(size: size, weight: style.weight, design: style.monospaced ? .monospaced : .default))
            .tracking(style.tracking)
            .lineSpacing(size * style.lineHeight - size)
    }
}

extension View {
    /// The token text style for `role`, following Dynamic Type.
    public func lecternFont(_ role: TextRole) -> some View {
        modifier(ScaledTextStyle(role))
    }
}
