// Generated from packages/design-tokens/tokens.json by `bun run tokens:build`. Do not edit.

import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Lectern 디자인 토큰. 규칙과 사용법은 저장소 루트의 DESIGN.md를 본다.
public enum LecternTokens {
    public enum Colors {
        /// 앱 바탕. 사이드바와 페이지 배경.
        public static let bgCanvas = SwiftUI.Color(lecternLight: 0xFBFBFB, dark: 0x0F1011)
        /// 주 작업 영역(목록, 본문)의 배경.
        public static let bgPanel = SwiftUI.Color(lecternLight: 0xFFFFFF, dark: 0x141516)
        /// 패널 위에 뜨는 표면: 카드, 상세 패널, 다이얼로그, 팔레트, 토스트, 보조 버튼.
        public static let bgRaised = SwiftUI.Color(lecternLight: 0xFFFFFF, dark: 0x1A1B1E)
        /// raised 표면 버튼의 hover.
        public static let bgRaisedHover = SwiftUI.Color(lecternLight: 0xF4F4F5, dark: 0x222327)
        /// 세그먼트·탭 선택 상태의 엄지(thumb).
        public static let bgControlSelected = SwiftUI.Color(lecternLight: 0xFFFFFF, dark: 0x2A2B30)
        /// 입력 필드 배경.
        public static let bgInput = SwiftUI.Color(lecternLight: 0xFFFFFF, dark: 0xFFFFFF, darkOpacity: 0.025)
        /// 행·메뉴 항목 hover. 아래 표면 위에 겹쳐 칠한다.
        public static let bgHover = SwiftUI.Color(lecternLight: 0x000000, lightOpacity: 0.035, dark: 0xFFFFFF, darkOpacity: 0.04)
        /// 키보드 선택 행, 활성 메뉴, 켜진 칩. 진행 막대·스위치의 빈 트랙.
        public static let bgActive = SwiftUI.Color(lecternLight: 0x000000, lightOpacity: 0.055, dark: 0xFFFFFF, darkOpacity: 0.07)
        /// 열린 항목(상세 패널에 표시 중인 행), 강조 배지, 텍스트 선택 영역.
        public static let bgSelected = SwiftUI.Color(lecternLight: 0x5E6AD2, lightOpacity: 0.12, dark: 0x5E6AD2, darkOpacity: 0.18)
        /// 모달·서랍 뒤를 덮는 막.
        public static let bgScrim = SwiftUI.Color(lecternLight: 0x0F1011, lightOpacity: 0.22, dark: 0x000000, darkOpacity: 0.55)
        /// 행·섹션 구분선. 장식용이며 컴포넌트를 식별하는 유일한 단서로 쓰지 않는다.
        public static let borderSubtle = SwiftUI.Color(lecternLight: 0xE8E8EA, dark: 0xFFFFFF, darkOpacity: 0.07)
        /// 카드, 보조 버튼, 입력 필드, 배지의 외곽선. 장식용.
        public static let borderDefault = SwiftUI.Color(lecternLight: 0xDCDCE0, dark: 0xFFFFFF, darkOpacity: 0.11)
        /// 외곽선이 유일한 식별 단서인 컨트롤(체크박스, 라디오, 레이블 없는 입력). 3:1 이상.
        public static let borderControl = SwiftUI.Color(lecternLight: 0x81848A, dark: 0x747880)
        /// 키보드 포커스 링과 선택 행 표시줄. 3:1 이상.
        public static let borderFocus = SwiftUI.Color(lecternLight: 0x5560C7, dark: 0x7180EA)
        /// 본문, 제목, 값. 채움색을 뺀 모든 표면 위에서 4.5:1 이상.
        public static let textPrimary = SwiftUI.Color(lecternLight: 0x1A1B1E, dark: 0xF7F8F8)
        /// 보조 설명, 레이블, 열 값. 채움색을 뺀 모든 표면 위에서 4.5:1 이상.
        public static let textSecondary = SwiftUI.Color(lecternLight: 0x595D64, dark: 0x9CA1AA)
        /// 개수, 힌트, 타임스탬프, 자리표시자. 채움색을 뺀 모든 표면 위에서 4.5:1 이상.
        public static let textTertiary = SwiftUI.Color(lecternLight: 0x666A71, dark: 0x8F949D)
        /// 비활성 컨트롤의 글자. WCAG 1.4.3 예외(비활성 UI)라 대비 기준을 두지 않는다.
        public static let textDisabled = SwiftUI.Color(lecternLight: 0x9CA1AA, dark: 0x666A71)
        /// accent.solid, status.danger.solid 같은 채움색 위의 글자와 아이콘.
        public static let textOnSolid = SwiftUI.Color(lecternLight: 0xFFFFFF, dark: 0xFFFFFF)
        /// 주요 버튼, 켜진 스위치, 진행 막대 채움, 로고.
        public static let accentSolid = SwiftUI.Color(lecternLight: 0x5E6AD2, dark: 0x5E6AD2)
        /// 주요 버튼 hover. 흰 글자 대비를 지키려고 두 테마 모두 한 단계 어둡게 간다.
        public static let accentSolidHover = SwiftUI.Color(lecternLight: 0x5560C7, dark: 0x5560C7)
        /// 강조 글자(소유자 배지, 강조 수치, 링크성 글자).
        public static let accentFg = SwiftUI.Color(lecternLight: 0x5560C7, dark: 0x9AA2F5)
        /// 강조 배지 테두리. 장식용.
        public static let accentBorder = SwiftUI.Color(lecternLight: 0x5E6AD2, lightOpacity: 0.45, dark: 0x5E6AD2, darkOpacity: 0.45)
        /// 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상.
        public static let statusSuccessFg = SwiftUI.Color(lecternLight: 0x0B794E, dark: 0x4CB782)
        /// 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상.
        public static let statusSuccessUi = SwiftUI.Color(lecternLight: 0x269865, dark: 0x4CB782)
        /// 상태 안내 상자(callout)의 옅은 배경.
        public static let statusSuccessSubtle = SwiftUI.Color(lecternLight: 0x269865, lightOpacity: 0.08, dark: 0x4CB782, darkOpacity: 0.1)
        /// 상태 배지·안내 상자의 테두리. 장식용.
        public static let statusSuccessBorder = SwiftUI.Color(lecternLight: 0x269865, lightOpacity: 0.35, dark: 0x4CB782, darkOpacity: 0.35)
        /// 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상.
        public static let statusAttentionFg = SwiftUI.Color(lecternLight: 0x886502, dark: 0xF2C94C)
        /// 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상.
        public static let statusAttentionUi = SwiftUI.Color(lecternLight: 0xA48203, dark: 0xF2C94C)
        /// 상태 안내 상자(callout)의 옅은 배경.
        public static let statusAttentionSubtle = SwiftUI.Color(lecternLight: 0xA48203, lightOpacity: 0.12, dark: 0xF2C94C, darkOpacity: 0.08)
        /// 상태 배지·안내 상자의 테두리. 장식용.
        public static let statusAttentionBorder = SwiftUI.Color(lecternLight: 0xA48203, lightOpacity: 0.35, dark: 0xF2C94C, darkOpacity: 0.35)
        /// 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상.
        public static let statusSevereFg = SwiftUI.Color(lecternLight: 0xA65404, dark: 0xF2994A)
        /// 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상.
        public static let statusSevereUi = SwiftUI.Color(lecternLight: 0xC67116, dark: 0xF2994A)
        /// 상태 안내 상자(callout)의 옅은 배경.
        public static let statusSevereSubtle = SwiftUI.Color(lecternLight: 0xC67116, lightOpacity: 0.08, dark: 0xF2994A, darkOpacity: 0.1)
        /// 상태 배지·안내 상자의 테두리. 장식용.
        public static let statusSevereBorder = SwiftUI.Color(lecternLight: 0xC67116, lightOpacity: 0.35, dark: 0xF2994A, darkOpacity: 0.35)
        /// 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상.
        public static let statusDangerFg = SwiftUI.Color(lecternLight: 0xC43336, dark: 0xF76260)
        /// 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상.
        public static let statusDangerUi = SwiftUI.Color(lecternLight: 0xE75454, dark: 0xE75454)
        /// 상태 안내 상자(callout)의 옅은 배경.
        public static let statusDangerSubtle = SwiftUI.Color(lecternLight: 0xE75454, lightOpacity: 0.07, dark: 0xE75454, darkOpacity: 0.09)
        /// 상태 배지·안내 상자의 테두리. 장식용.
        public static let statusDangerBorder = SwiftUI.Color(lecternLight: 0xE75454, lightOpacity: 0.35, dark: 0xE75454, darkOpacity: 0.35)
        /// 파괴적 작업 버튼의 채움색.
        public static let statusDangerSolid = SwiftUI.Color(lecternLight: 0xCF3C3C, dark: 0xCF3C3C)
        /// 파괴적 작업 버튼 hover.
        public static let statusDangerSolidHover = SwiftUI.Color(lecternLight: 0xC43336, dark: 0xC43336)
        /// 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상.
        public static let statusInfoFg = SwiftUI.Color(lecternLight: 0x0F6BC1, dark: 0x4EA7FC)
        /// 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상.
        public static let statusInfoUi = SwiftUI.Color(lecternLight: 0x2E8ADD, dark: 0x4EA7FC)
        /// 상태 안내 상자(callout)의 옅은 배경.
        public static let statusInfoSubtle = SwiftUI.Color(lecternLight: 0x2E8ADD, lightOpacity: 0.08, dark: 0x4EA7FC, darkOpacity: 0.1)
        /// 상태 배지·안내 상자의 테두리. 장식용.
        public static let statusInfoBorder = SwiftUI.Color(lecternLight: 0x2E8ADD, lightOpacity: 0.35, dark: 0x4EA7FC, darkOpacity: 0.35)
    }

    public enum Space {
        public static let s0: CGFloat = 0
        public static let s2: CGFloat = 2
        public static let s4: CGFloat = 4
        public static let s6: CGFloat = 6
        public static let s8: CGFloat = 8
        public static let s12: CGFloat = 12
        public static let s16: CGFloat = 16
        public static let s20: CGFloat = 20
        public static let s24: CGFloat = 24
        public static let s32: CGFloat = 32
        public static let s40: CGFloat = 40
        public static let s48: CGFloat = 48
        public static let s64: CGFloat = 64
    }

    public enum Size {
        /// 작은 버튼, 칩, 툴바 아이콘 버튼. WCAG 2.5.8 최소 표적 크기.
        public static let controlSm: CGFloat = 24
        /// 기본 버튼, 검색 입력.
        public static let controlMd: CGFloat = 28
        /// 입력 필드, 터치 우선 화면의 기본 컨트롤.
        public static let controlLg: CGFloat = 32
        /// 조밀한 목록 행.
        public static let rowCompact: CGFloat = 32
        /// 기본 목록 행.
        public static let rowDefault: CGFloat = 36
        /// 터치 화면 목록 행(Apple HIG 44pt).
        public static let rowComfortable: CGFloat = 44
        public static let iconSm: CGFloat = 14
        public static let iconMd: CGFloat = 16
        public static let iconLg: CGFloat = 20
        /// 상세 패널 너비.
        public static let peekWidth: CGFloat = 448
        /// 사이드바 너비.
        public static let sidebarWidth: CGFloat = 232
    }

    public enum Radius {
        /// 배지, 키캡, 막대.
        public static let xs: CGFloat = 4
        /// 버튼, 입력, 칩, 목록 항목.
        public static let sm: CGFloat = 6
        /// 카드, 패널, 토스트.
        public static let md: CGFloat = 8
        /// 다이얼로그, 명령 팔레트.
        public static let lg: CGFloat = 10
        /// 원형(아바타, 상태 점, 스위치).
        public static let full: CGFloat = 9999
    }

    public enum Fonts {
        /// UI와 문서 본문. 웹은 Pretendard Variable, 네이티브는 시스템 글꼴을 쓴다.
        public static let familySans: [String] = ["Pretendard Variable", "Pretendard", "-apple-system", "BlinkMacSystemFont", "system-ui", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "sans-serif"]
        /// ID, 로그, 코드, 타임스탬프.
        public static let familyMono: [String] = ["SF Mono", "ui-monospace", "JetBrains Mono", "D2Coding", "Menlo", "Consolas", "monospace"]
        /// 배지, 키캡, 캡션.
        public static let sizeXs: CGFloat = 11
        /// 메타 정보, 보조 열, 레이블.
        public static let sizeSm: CGFloat = 12
        /// UI 본문과 컨트롤.
        public static let sizeBase: CGFloat = 13
        /// 섹션 제목, 다이얼로그 제목, 팔레트 입력.
        public static let sizeMd: CGFloat = 14
        /// 상세 패널 제목.
        public static let sizeLg: CGFloat = 16
        /// 문서 본문(긴 글 읽기).
        public static let sizeReading: CGFloat = 15
        /// 페이지 제목.
        public static let sizeXl: CGFloat = 20
        /// 핵심 수치(KPI).
        public static let sizeXxl: CGFloat = 24
        public static let weightRegular: SwiftUI.Font.Weight = .regular
        public static let weightMedium: SwiftUI.Font.Weight = .medium
        public static let weightSemibold: SwiftUI.Font.Weight = .semibold
        public static let weightBold: SwiftUI.Font.Weight = .bold
        /// 큰 수치, 한 줄 제목.
        public static let lineHeightTight: CGFloat = 1.25
        /// 여러 줄 제목.
        public static let lineHeightSnug: CGFloat = 1.35
        /// UI 본문.
        public static let lineHeightBase: CGFloat = 1.45
        /// 설명 문단, 다이얼로그 본문.
        public static let lineHeightRelaxed: CGFloat = 1.6
        /// 문서 본문. 한글 긴 글은 1.6 이상.
        public static let lineHeightReading: CGFloat = 1.7
    }

    public enum TextStyles {
        /// 메타 정보, 힌트.
        public static let caption = LecternTextStyle(size: 12, weight: .regular, lineHeight: 1.45, tracking: -0.07, monospaced: false)
        /// UI 기본 글자.
        public static let body = LecternTextStyle(size: 13, weight: .regular, lineHeight: 1.45, tracking: -0.08, monospaced: false)
        /// 필드 레이블, 그룹 머리글.
        public static let label = LecternTextStyle(size: 12, weight: .medium, lineHeight: 1.45, tracking: -0.07, monospaced: false)
        /// 섹션·다이얼로그 제목.
        public static let title = LecternTextStyle(size: 14, weight: .semibold, lineHeight: 1.35, tracking: -0.15, monospaced: false)
        /// 상세 패널 제목.
        public static let heading = LecternTextStyle(size: 16, weight: .semibold, lineHeight: 1.35, tracking: -0.24, monospaced: false)
        /// 핵심 수치.
        public static let display = LecternTextStyle(size: 24, weight: .semibold, lineHeight: 1.25, tracking: -0.48, monospaced: false)
        /// 문서 본문.
        public static let reading = LecternTextStyle(size: 15, weight: .regular, lineHeight: 1.7, tracking: 0, monospaced: false)
        /// ID, 로그, 타임스탬프.
        public static let mono = LecternTextStyle(size: 12, weight: .regular, lineHeight: 1.45, tracking: 0, monospaced: true)
    }

    public enum Shadows {
        /// 세그먼트 엄지, 눌리는 표면. 1단계.
        public static let sm: [LecternShadow] = [
            LecternShadow(color: SwiftUI.Color(lecternLight: 0x000000, lightOpacity: 0.18, dark: 0x000000, darkOpacity: 0.18), x: 0, y: 1, blur: 2, spread: 0),
        ]
        /// 메뉴, 팝오버, 툴팁. 2단계.
        public static let md: [LecternShadow] = [
            LecternShadow(color: SwiftUI.Color(lecternLight: 0x000000, lightOpacity: 0.08, dark: 0x000000, darkOpacity: 0.35), x: 0, y: 4, blur: 16, spread: 0),
            LecternShadow(color: SwiftUI.Color(lecternLight: 0x000000, lightOpacity: 0.05, dark: 0xFFFFFF, darkOpacity: 0.04), x: 0, y: 0, blur: 0, spread: 1),
        ]
        /// 상세 패널, 다이얼로그, 명령 팔레트, 토스트. 3단계.
        public static let lg: [LecternShadow] = [
            LecternShadow(color: SwiftUI.Color(lecternLight: 0x000000, lightOpacity: 0.12, dark: 0x000000, darkOpacity: 0.5), x: 0, y: 16, blur: 48, spread: 0),
            LecternShadow(color: SwiftUI.Color(lecternLight: 0x000000, lightOpacity: 0.05, dark: 0xFFFFFF, darkOpacity: 0.04), x: 0, y: 0, blur: 0, spread: 1),
        ]
    }

    public enum Motion {
        /// hover, 색 변화, 스위치.
        public static let durationFast: TimeInterval = 0.1
        /// 패널·서랍 슬라이드, 토스트 등장.
        public static let durationBase: TimeInterval = 0.16
        /// 큰 레이아웃 전환. 이보다 길게 쓰지 않는다.
        public static let durationSlow: TimeInterval = 0.24
        /// 기본(CSS ease와 같다).
        public static let easingStandard = LecternCubicBezier(x1: 0.25, y1: 0.1, x2: 0.25, y2: 1.0)
        /// 나타날 때(감속).
        public static let easingEnter = LecternCubicBezier(x1: 0.0, y1: 0.0, x2: 0.2, y2: 1.0)
        /// 사라질 때(가속).
        public static let easingExit = LecternCubicBezier(x1: 0.4, y1: 0.0, x2: 1.0, y2: 1.0)
    }

    public enum ZIndex {
        /// 스크롤 영역 안의 고정 머리글.
        public static let sticky: Double = 10.0
        /// 상세 패널.
        public static let peek: Double = 40.0
        /// 서랍 뒤 막.
        public static let scrim: Double = 45.0
        /// 모바일 사이드바 서랍.
        public static let drawer: Double = 50.0
        /// 다이얼로그, 명령 팔레트, 시트.
        public static let overlay: Double = 60.0
        /// 메뉴, 팝오버(다이얼로그 위에도 뜬다).
        public static let popover: Double = 70.0
        /// 토스트.
        public static let toast: Double = 80.0
        /// 툴팁.
        public static let tooltip: Double = 85.0
        /// 로그인·권한 차단 화면.
        public static let gate: Double = 90.0
    }
}

/// 글자 조합. 웹은 Pretendard, 네이티브는 시스템 글꼴(SF Pro + Apple SD Gothic Neo)을 쓴다.
public struct LecternTextStyle: Sendable, Equatable {
    public let size: CGFloat
    public let weight: SwiftUI.Font.Weight
    /// 글자 크기에 곱하는 줄 높이 배수.
    public let lineHeight: CGFloat
    /// 자간(pt).
    public let tracking: CGFloat
    public let monospaced: Bool

    public var font: SwiftUI.Font {
        .system(size: size, weight: weight, design: monospaced ? .monospaced : .default)
    }

    /// `.lineSpacing(_:)`에 넘길 값. SwiftUI는 줄 높이가 아니라 줄 사이 간격을 받는다.
    public var lineSpacing: CGFloat { size * lineHeight - size }
}

/// 그림자 한 겹. `blur`는 CSS 값 그대로이고, SwiftUI `shadow(radius:)`에는 `radius`를 넘긴다.
public struct LecternShadow: Sendable {
    public let color: SwiftUI.Color
    public let x: CGFloat
    public let y: CGFloat
    public let blur: CGFloat
    /// SwiftUI는 spread를 지원하지 않는다. 1px 외곽선 겹은 `overlay`의 `strokeBorder`로 그린다.
    public let spread: CGFloat

    public var radius: CGFloat { blur / 2 }
}

/// CSS `cubic-bezier()`와 같은 이징 곡선.
public struct LecternCubicBezier: Sendable, Equatable {
    public let x1: Double
    public let y1: Double
    public let x2: Double
    public let y2: Double

    public func animation(duration: TimeInterval) -> SwiftUI.Animation {
        .timingCurve(x1, y1, x2, y2, duration: duration)
    }
}

extension SwiftUI.Color {
    /// 시스템 외관(라이트/다크)을 따라가는 sRGB 색.
    init(lecternLight light: UInt32, lightOpacity: Double = 1, dark: UInt32, darkOpacity: Double = 1) {
        #if os(macOS)
        self.init(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return lecternPlatformColor(isDark ? dark : light, opacity: isDark ? darkOpacity : lightOpacity)
        })
        #else
        self.init(uiColor: UIColor { traits in
            let isDark = traits.userInterfaceStyle == .dark
            return lecternPlatformColor(isDark ? dark : light, opacity: isDark ? darkOpacity : lightOpacity)
        })
        #endif
    }
}

#if os(macOS)
private func lecternPlatformColor(_ rgb: UInt32, opacity: Double) -> NSColor {
    NSColor(
        srgbRed: CGFloat((rgb >> 16) & 0xFF) / 255,
        green: CGFloat((rgb >> 8) & 0xFF) / 255,
        blue: CGFloat(rgb & 0xFF) / 255,
        alpha: CGFloat(opacity)
    )
}
#else
private func lecternPlatformColor(_ rgb: UInt32, opacity: Double) -> UIColor {
    UIColor(
        red: CGFloat((rgb >> 16) & 0xFF) / 255,
        green: CGFloat((rgb >> 8) & 0xFF) / 255,
        blue: CGFloat(rgb & 0xFF) / 255,
        alpha: CGFloat(opacity)
    )
}
#endif
