// Generated from packages/design-tokens/tokens.json by `bun run tokens:build`. Do not edit.

package com.qucord.lectern.design

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/** 그림자 한 겹. Compose 기본 shadow 대신 직접 그릴 때 쓴다. */
@Immutable
data class LecternShadow(val color: Color, val offsetX: Dp, val offsetY: Dp, val blur: Dp, val spread: Dp)

/** 테마에 따라 바뀌는 색. 모드별 인스턴스 중 하나를 CompositionLocal로 내려준다. */
@Immutable
data class LecternColors(
    /** 앱 바탕. 사이드바와 페이지 배경. */
    val bgCanvas: Color,
    /** 주 작업 영역(목록, 본문)의 배경. */
    val bgPanel: Color,
    /** 패널 위에 뜨는 표면: 카드, 상세 패널, 다이얼로그, 팔레트, 토스트, 보조 버튼. */
    val bgRaised: Color,
    /** raised 표면 버튼의 hover. */
    val bgRaisedHover: Color,
    /** 세그먼트·탭 선택 상태의 엄지(thumb). */
    val bgControlSelected: Color,
    /** 입력 필드 배경. */
    val bgInput: Color,
    /** 행·메뉴 항목 hover. 아래 표면 위에 겹쳐 칠한다. */
    val bgHover: Color,
    /** 키보드 선택 행, 활성 메뉴, 켜진 칩. 진행 막대·스위치의 빈 트랙. */
    val bgActive: Color,
    /** 열린 항목(상세 패널에 표시 중인 행), 강조 배지, 텍스트 선택 영역. */
    val bgSelected: Color,
    /** 모달·서랍 뒤를 덮는 막. */
    val bgScrim: Color,
    /** 행·섹션 구분선. 장식용이며 컴포넌트를 식별하는 유일한 단서로 쓰지 않는다. */
    val borderSubtle: Color,
    /** 카드, 보조 버튼, 입력 필드, 배지의 외곽선. 장식용. */
    val borderDefault: Color,
    /** 외곽선이 유일한 식별 단서인 컨트롤(체크박스, 라디오, 레이블 없는 입력). 3:1 이상. */
    val borderControl: Color,
    /** 키보드 포커스 링과 선택 행 표시줄. 3:1 이상. */
    val borderFocus: Color,
    /** 본문, 제목, 값. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. */
    val textPrimary: Color,
    /** 보조 설명, 레이블, 열 값. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. */
    val textSecondary: Color,
    /** 개수, 힌트, 타임스탬프, 자리표시자. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. */
    val textTertiary: Color,
    /** 비활성 컨트롤의 글자. WCAG 1.4.3 예외(비활성 UI)라 대비 기준을 두지 않는다. */
    val textDisabled: Color,
    /** accent.solid, status.danger.solid 같은 채움색 위의 글자와 아이콘. */
    val textOnSolid: Color,
    /** 주요 버튼, 켜진 스위치, 진행 막대 채움, 로고. */
    val accentSolid: Color,
    /** 주요 버튼 hover. 흰 글자 대비를 지키려고 두 테마 모두 한 단계 어둡게 간다. */
    val accentSolidHover: Color,
    /** 강조 글자(소유자 배지, 강조 수치, 링크성 글자). */
    val accentFg: Color,
    /** 강조 배지 테두리. 장식용. */
    val accentBorder: Color,
    /** 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. */
    val statusSuccessFg: Color,
    /** 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상. */
    val statusSuccessUi: Color,
    /** 상태 안내 상자(callout)의 옅은 배경. */
    val statusSuccessSubtle: Color,
    /** 상태 배지·안내 상자의 테두리. 장식용. */
    val statusSuccessBorder: Color,
    /** 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. */
    val statusAttentionFg: Color,
    /** 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상. */
    val statusAttentionUi: Color,
    /** 상태 안내 상자(callout)의 옅은 배경. */
    val statusAttentionSubtle: Color,
    /** 상태 배지·안내 상자의 테두리. 장식용. */
    val statusAttentionBorder: Color,
    /** 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. */
    val statusSevereFg: Color,
    /** 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상. */
    val statusSevereUi: Color,
    /** 상태 안내 상자(callout)의 옅은 배경. */
    val statusSevereSubtle: Color,
    /** 상태 배지·안내 상자의 테두리. 장식용. */
    val statusSevereBorder: Color,
    /** 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. */
    val statusDangerFg: Color,
    /** 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상. */
    val statusDangerUi: Color,
    /** 상태 안내 상자(callout)의 옅은 배경. */
    val statusDangerSubtle: Color,
    /** 상태 배지·안내 상자의 테두리. 장식용. */
    val statusDangerBorder: Color,
    /** 파괴적 작업 버튼의 채움색. */
    val statusDangerSolid: Color,
    /** 파괴적 작업 버튼 hover. */
    val statusDangerSolidHover: Color,
    /** 상태 글자와 작은 아이콘. 채움색을 뺀 모든 표면 위에서 4.5:1 이상. */
    val statusInfoFg: Color,
    /** 상태 점, 진행 막대, 아이콘. 채움색을 뺀 모든 표면 위에서 3:1 이상. */
    val statusInfoUi: Color,
    /** 상태 안내 상자(callout)의 옅은 배경. */
    val statusInfoSubtle: Color,
    /** 상태 배지·안내 상자의 테두리. 장식용. */
    val statusInfoBorder: Color,
)

val LecternLightColors = LecternColors(
    bgCanvas = Color(0xFFFBFBFB),
    bgPanel = Color(0xFFFFFFFF),
    bgRaised = Color(0xFFFFFFFF),
    bgRaisedHover = Color(0xFFF4F4F5),
    bgControlSelected = Color(0xFFFFFFFF),
    bgInput = Color(0xFFFFFFFF),
    bgHover = Color(red = 0.0f, green = 0.0f, blue = 0.0f, alpha = 0.035f),
    bgActive = Color(red = 0.0f, green = 0.0f, blue = 0.0f, alpha = 0.055f),
    bgSelected = Color(red = 0.3686f, green = 0.4157f, blue = 0.8235f, alpha = 0.12f),
    bgScrim = Color(red = 0.0588f, green = 0.0627f, blue = 0.0667f, alpha = 0.22f),
    borderSubtle = Color(0xFFE8E8EA),
    borderDefault = Color(0xFFDCDCE0),
    borderControl = Color(0xFF81848A),
    borderFocus = Color(0xFF5560C7),
    textPrimary = Color(0xFF1A1B1E),
    textSecondary = Color(0xFF595D64),
    textTertiary = Color(0xFF666A71),
    textDisabled = Color(0xFF9CA1AA),
    textOnSolid = Color(0xFFFFFFFF),
    accentSolid = Color(0xFF5E6AD2),
    accentSolidHover = Color(0xFF5560C7),
    accentFg = Color(0xFF5560C7),
    accentBorder = Color(red = 0.3686f, green = 0.4157f, blue = 0.8235f, alpha = 0.45f),
    statusSuccessFg = Color(0xFF0B794E),
    statusSuccessUi = Color(0xFF269865),
    statusSuccessSubtle = Color(red = 0.149f, green = 0.5961f, blue = 0.3961f, alpha = 0.08f),
    statusSuccessBorder = Color(red = 0.149f, green = 0.5961f, blue = 0.3961f, alpha = 0.35f),
    statusAttentionFg = Color(0xFF886502),
    statusAttentionUi = Color(0xFFA48203),
    statusAttentionSubtle = Color(red = 0.6431f, green = 0.5098f, blue = 0.0118f, alpha = 0.12f),
    statusAttentionBorder = Color(red = 0.6431f, green = 0.5098f, blue = 0.0118f, alpha = 0.35f),
    statusSevereFg = Color(0xFFA65404),
    statusSevereUi = Color(0xFFC67116),
    statusSevereSubtle = Color(red = 0.7765f, green = 0.4431f, blue = 0.0863f, alpha = 0.08f),
    statusSevereBorder = Color(red = 0.7765f, green = 0.4431f, blue = 0.0863f, alpha = 0.35f),
    statusDangerFg = Color(0xFFC43336),
    statusDangerUi = Color(0xFFE75454),
    statusDangerSubtle = Color(red = 0.9059f, green = 0.3294f, blue = 0.3294f, alpha = 0.07f),
    statusDangerBorder = Color(red = 0.9059f, green = 0.3294f, blue = 0.3294f, alpha = 0.35f),
    statusDangerSolid = Color(0xFFCF3C3C),
    statusDangerSolidHover = Color(0xFFC43336),
    statusInfoFg = Color(0xFF0F6BC1),
    statusInfoUi = Color(0xFF2E8ADD),
    statusInfoSubtle = Color(red = 0.1804f, green = 0.5412f, blue = 0.8667f, alpha = 0.08f),
    statusInfoBorder = Color(red = 0.1804f, green = 0.5412f, blue = 0.8667f, alpha = 0.35f),
)

val LecternDarkColors = LecternColors(
    bgCanvas = Color(0xFF0F1011),
    bgPanel = Color(0xFF141516),
    bgRaised = Color(0xFF1A1B1E),
    bgRaisedHover = Color(0xFF222327),
    bgControlSelected = Color(0xFF2A2B30),
    bgInput = Color(red = 1.0f, green = 1.0f, blue = 1.0f, alpha = 0.025f),
    bgHover = Color(red = 1.0f, green = 1.0f, blue = 1.0f, alpha = 0.04f),
    bgActive = Color(red = 1.0f, green = 1.0f, blue = 1.0f, alpha = 0.07f),
    bgSelected = Color(red = 0.3686f, green = 0.4157f, blue = 0.8235f, alpha = 0.18f),
    bgScrim = Color(red = 0.0f, green = 0.0f, blue = 0.0f, alpha = 0.55f),
    borderSubtle = Color(red = 1.0f, green = 1.0f, blue = 1.0f, alpha = 0.07f),
    borderDefault = Color(red = 1.0f, green = 1.0f, blue = 1.0f, alpha = 0.11f),
    borderControl = Color(0xFF747880),
    borderFocus = Color(0xFF7180EA),
    textPrimary = Color(0xFFF7F8F8),
    textSecondary = Color(0xFF9CA1AA),
    textTertiary = Color(0xFF8F949D),
    textDisabled = Color(0xFF666A71),
    textOnSolid = Color(0xFFFFFFFF),
    accentSolid = Color(0xFF5E6AD2),
    accentSolidHover = Color(0xFF5560C7),
    accentFg = Color(0xFF9AA2F5),
    accentBorder = Color(red = 0.3686f, green = 0.4157f, blue = 0.8235f, alpha = 0.45f),
    statusSuccessFg = Color(0xFF4CB782),
    statusSuccessUi = Color(0xFF4CB782),
    statusSuccessSubtle = Color(red = 0.298f, green = 0.7176f, blue = 0.5098f, alpha = 0.1f),
    statusSuccessBorder = Color(red = 0.298f, green = 0.7176f, blue = 0.5098f, alpha = 0.35f),
    statusAttentionFg = Color(0xFFF2C94C),
    statusAttentionUi = Color(0xFFF2C94C),
    statusAttentionSubtle = Color(red = 0.949f, green = 0.7882f, blue = 0.298f, alpha = 0.08f),
    statusAttentionBorder = Color(red = 0.949f, green = 0.7882f, blue = 0.298f, alpha = 0.35f),
    statusSevereFg = Color(0xFFF2994A),
    statusSevereUi = Color(0xFFF2994A),
    statusSevereSubtle = Color(red = 0.949f, green = 0.6f, blue = 0.2902f, alpha = 0.1f),
    statusSevereBorder = Color(red = 0.949f, green = 0.6f, blue = 0.2902f, alpha = 0.35f),
    statusDangerFg = Color(0xFFF76260),
    statusDangerUi = Color(0xFFE75454),
    statusDangerSubtle = Color(red = 0.9059f, green = 0.3294f, blue = 0.3294f, alpha = 0.09f),
    statusDangerBorder = Color(red = 0.9059f, green = 0.3294f, blue = 0.3294f, alpha = 0.35f),
    statusDangerSolid = Color(0xFFCF3C3C),
    statusDangerSolidHover = Color(0xFFC43336),
    statusInfoFg = Color(0xFF4EA7FC),
    statusInfoUi = Color(0xFF4EA7FC),
    statusInfoSubtle = Color(red = 0.3059f, green = 0.6549f, blue = 0.9882f, alpha = 0.1f),
    statusInfoBorder = Color(red = 0.3059f, green = 0.6549f, blue = 0.9882f, alpha = 0.35f),
)

/** 테마에 따라 바뀌는 그림자(겹 목록). Compose 기본 shadow는 색을 받지 않으므로 직접 그릴 때 쓴다. */
@Immutable
data class LecternElevation(
    /** 세그먼트 엄지, 눌리는 표면. 1단계. */
    val sm: List<LecternShadow>,
    /** 메뉴, 팝오버, 툴팁. 2단계. */
    val md: List<LecternShadow>,
    /** 상세 패널, 다이얼로그, 명령 팔레트, 토스트. 3단계. */
    val lg: List<LecternShadow>,
)

val LecternLightElevation = LecternElevation(
    sm = listOf(LecternShadow(Color(red = 0.0f, green = 0.0f, blue = 0.0f, alpha = 0.18f), 0.dp, 1.dp, 2.dp, 0.dp)),
    md = listOf(LecternShadow(Color(red = 0.0f, green = 0.0f, blue = 0.0f, alpha = 0.08f), 0.dp, 4.dp, 16.dp, 0.dp), LecternShadow(Color(red = 0.0f, green = 0.0f, blue = 0.0f, alpha = 0.05f), 0.dp, 0.dp, 0.dp, 1.dp)),
    lg = listOf(LecternShadow(Color(red = 0.0f, green = 0.0f, blue = 0.0f, alpha = 0.12f), 0.dp, 16.dp, 48.dp, 0.dp), LecternShadow(Color(red = 0.0f, green = 0.0f, blue = 0.0f, alpha = 0.05f), 0.dp, 0.dp, 0.dp, 1.dp)),
)

val LecternDarkElevation = LecternElevation(
    sm = listOf(LecternShadow(Color(red = 0.0f, green = 0.0f, blue = 0.0f, alpha = 0.18f), 0.dp, 1.dp, 2.dp, 0.dp)),
    md = listOf(LecternShadow(Color(red = 0.0f, green = 0.0f, blue = 0.0f, alpha = 0.35f), 0.dp, 4.dp, 16.dp, 0.dp), LecternShadow(Color(red = 1.0f, green = 1.0f, blue = 1.0f, alpha = 0.04f), 0.dp, 0.dp, 0.dp, 1.dp)),
    lg = listOf(LecternShadow(Color(red = 0.0f, green = 0.0f, blue = 0.0f, alpha = 0.5f), 0.dp, 16.dp, 48.dp, 0.dp), LecternShadow(Color(red = 1.0f, green = 1.0f, blue = 1.0f, alpha = 0.04f), 0.dp, 0.dp, 0.dp, 1.dp)),
)

/** Lectern 디자인 토큰 중 테마와 무관한 값. 규칙과 사용법은 저장소 루트의 DESIGN.md를 본다. */
object LecternTokens {
    object Space {
        val s0 = 0.dp
        val s2 = 2.dp
        val s4 = 4.dp
        val s6 = 6.dp
        val s8 = 8.dp
        val s12 = 12.dp
        val s16 = 16.dp
        val s20 = 20.dp
        val s24 = 24.dp
        val s32 = 32.dp
        val s40 = 40.dp
        val s48 = 48.dp
        val s64 = 64.dp
    }

    object Size {
        /** 작은 버튼, 칩, 툴바 아이콘 버튼. WCAG 2.5.8 최소 표적 크기. */
        val controlSm = 24.dp
        /** 기본 버튼, 검색 입력. */
        val controlMd = 28.dp
        /** 입력 필드, 터치 우선 화면의 기본 컨트롤. */
        val controlLg = 32.dp
        /** 조밀한 목록 행. */
        val rowCompact = 32.dp
        /** 기본 목록 행. */
        val rowDefault = 36.dp
        /** 터치 화면 목록 행(Apple HIG 44pt). */
        val rowComfortable = 44.dp
        val iconSm = 14.dp
        val iconMd = 16.dp
        val iconLg = 20.dp
        /** 상세 패널 너비. */
        val peekWidth = 448.dp
        /** 사이드바 너비. */
        val sidebarWidth = 232.dp
    }

    object Radius {
        /** 배지, 키캡, 막대. */
        val xs = 4.dp
        /** 버튼, 입력, 칩, 목록 항목. */
        val sm = 6.dp
        /** 카드, 패널, 토스트. */
        val md = 8.dp
        /** 다이얼로그, 명령 팔레트. */
        val lg = 10.dp
        /** 원형(아바타, 상태 점, 스위치). */
        val full = 9999.dp
    }

    object Fonts {
        /** UI와 문서 본문. 웹은 Pretendard Variable, 네이티브는 시스템 글꼴을 쓴다. */
        val familySans: List<String> = listOf("Pretendard Variable", "Pretendard", "-apple-system", "BlinkMacSystemFont", "system-ui", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "sans-serif")
        /** ID, 로그, 코드, 타임스탬프. */
        val familyMono: List<String> = listOf("SF Mono", "ui-monospace", "JetBrains Mono", "D2Coding", "Menlo", "Consolas", "monospace")
        /** 배지, 키캡, 캡션. */
        val sizeXs = 11.sp
        /** 메타 정보, 보조 열, 레이블. */
        val sizeSm = 12.sp
        /** UI 본문과 컨트롤. */
        val sizeBase = 13.sp
        /** 섹션 제목, 다이얼로그 제목, 팔레트 입력. */
        val sizeMd = 14.sp
        /** 상세 패널 제목. */
        val sizeLg = 16.sp
        /** 문서 본문(긴 글 읽기). */
        val sizeReading = 15.sp
        /** 페이지 제목. */
        val sizeXl = 20.sp
        /** 핵심 수치(KPI). */
        val sizeXxl = 24.sp
        val weightRegular = FontWeight(400)
        val weightMedium = FontWeight(500)
        val weightSemibold = FontWeight(600)
        val weightBold = FontWeight(700)
        /** 큰 수치, 한 줄 제목. */
        const val lineHeightTight: Float = 1.25f
        /** 여러 줄 제목. */
        const val lineHeightSnug: Float = 1.35f
        /** UI 본문. */
        const val lineHeightBase: Float = 1.45f
        /** 설명 문단, 다이얼로그 본문. */
        const val lineHeightRelaxed: Float = 1.6f
        /** 문서 본문. 한글 긴 글은 1.6 이상. */
        const val lineHeightReading: Float = 1.7f
    }

    object TextStyles {
        /** 메타 정보, 힌트. */
        val caption = TextStyle(fontFamily = FontFamily.Default, fontSize = 12.sp, fontWeight = FontWeight(400), lineHeight = 1.45.em, letterSpacing = (-0.07).sp)
        /** UI 기본 글자. */
        val body = TextStyle(fontFamily = FontFamily.Default, fontSize = 13.sp, fontWeight = FontWeight(400), lineHeight = 1.45.em, letterSpacing = (-0.08).sp)
        /** 필드 레이블, 그룹 머리글. */
        val label = TextStyle(fontFamily = FontFamily.Default, fontSize = 12.sp, fontWeight = FontWeight(500), lineHeight = 1.45.em, letterSpacing = (-0.07).sp)
        /** 섹션·다이얼로그 제목. */
        val title = TextStyle(fontFamily = FontFamily.Default, fontSize = 14.sp, fontWeight = FontWeight(600), lineHeight = 1.35.em, letterSpacing = (-0.15).sp)
        /** 상세 패널 제목. */
        val heading = TextStyle(fontFamily = FontFamily.Default, fontSize = 16.sp, fontWeight = FontWeight(600), lineHeight = 1.35.em, letterSpacing = (-0.24).sp)
        /** 핵심 수치. */
        val display = TextStyle(fontFamily = FontFamily.Default, fontSize = 24.sp, fontWeight = FontWeight(600), lineHeight = 1.25.em, letterSpacing = (-0.48).sp)
        /** 문서 본문. */
        val reading = TextStyle(fontFamily = FontFamily.Default, fontSize = 15.sp, fontWeight = FontWeight(400), lineHeight = 1.7.em, letterSpacing = 0.sp)
        /** ID, 로그, 타임스탬프. */
        val mono = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp, fontWeight = FontWeight(400), lineHeight = 1.45.em, letterSpacing = 0.sp)
    }

    object Motion {
        /** hover, 색 변화, 스위치. */
        const val durationFast: Int = 100
        /** 패널·서랍 슬라이드, 토스트 등장. */
        const val durationBase: Int = 160
        /** 큰 레이아웃 전환. 이보다 길게 쓰지 않는다. */
        const val durationSlow: Int = 240
        /** 기본(CSS ease와 같다). */
        val easingStandard = CubicBezierEasing(0.25f, 0.1f, 0.25f, 1.0f)
        /** 나타날 때(감속). */
        val easingEnter = CubicBezierEasing(0.0f, 0.0f, 0.2f, 1.0f)
        /** 사라질 때(가속). */
        val easingExit = CubicBezierEasing(0.4f, 0.0f, 1.0f, 1.0f)
    }

    object ZIndex {
        /** 스크롤 영역 안의 고정 머리글. */
        const val sticky: Float = 10.0f
        /** 상세 패널. */
        const val peek: Float = 40.0f
        /** 서랍 뒤 막. */
        const val scrim: Float = 45.0f
        /** 모바일 사이드바 서랍. */
        const val drawer: Float = 50.0f
        /** 다이얼로그, 명령 팔레트, 시트. */
        const val overlay: Float = 60.0f
        /** 메뉴, 팝오버(다이얼로그 위에도 뜬다). */
        const val popover: Float = 70.0f
        /** 토스트. */
        const val toast: Float = 80.0f
        /** 툴팁. */
        const val tooltip: Float = 85.0f
        /** 로그인·권한 차단 화면. */
        const val gate: Float = 90.0f
    }
}
