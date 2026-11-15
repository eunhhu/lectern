import AppKit
import LecternKit
import LecternUI
import SwiftUI

/// The menu bar item: the icon, plus the elapsed time while recording. Always on screen, so it
/// is also what opens the main window when something asks for it (the HUD, a notification).
struct MenuBarLabel: View {
    @ObservedObject var state: MenuBarState
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        HStack(spacing: LecternTokens.Space.s4) {
            Image(systemName: icon)
            if let title = state.title {
                Text(verbatim: title)
                    .monospacedDigit()
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(state.accessibilityLabel)
        .onChange(of: state.windowRequest) { _, _ in
            MainWindowOpener.open(openWindow)
        }
    }

    private var icon: String {
        if state.failed { return "exclamationmark.triangle" }
        return state.title == nil ? "waveform" : "record.circle.fill"
    }
}

@MainActor
enum MainWindowOpener {
    static let id = "main"
    /// The main window, reported by the window itself (`MainWindow`).
    static weak var window: NSWindow?

    /// Brings the main window forward; opens it only when there is none on screen (a
    /// `WindowGroup` would open another one each time).
    static func open(_ openWindow: OpenWindowAction) {
        NSApp.activate()
        if let window, window.isVisible || window.isMiniaturized {
            if window.isMiniaturized { window.deminiaturize(nil) }
            window.makeKeyAndOrderFront(nil)
        } else {
            openWindow(id: id)
        }
    }
}

/// The window under the menu bar icon: record, pause, "중요", the level, the elapsed time, the
/// folder, the upload queue, and the ways into the app.
struct MenuBarHUD: View {
    @ObservedObject var services: MacServices
    @ObservedObject var recording: MacRecordingViewModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: LecternTokens.Space.s12) {
            switch services.session {
            case .starting:
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel("불러오는 중")
            case .signedOut:
                signedOut
            case .signedIn:
                recorder
                uploadSummary
            }
            Divider()
            links
        }
        .padding(LecternTokens.Space.s16)
        .frame(width: 320)
        .task { await services.refreshAccount() }
    }

    // MARK: - Signed out

    private var signedOut: some View {
        VStack(alignment: .leading, spacing: LecternTokens.Space.s8) {
            Text(verbatim: MacRecordingViewModel.signInNeededText)
                .lecternFont(.title)
            Button("로그인") { MainWindowOpener.open(openWindow) }
                .buttonStyle(.borderedProminent)
        }
    }

    // MARK: - Recorder

    @ViewBuilder
    private var recorder: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(verbatim: statusText)
                .lecternFont(.title)
            Spacer()
            if let elapsed = elapsedMs {
                Text(verbatim: MacRecordingViewModel.elapsedText(elapsed))
                    .font(.system(size: 22, weight: .semibold).monospacedDigit())
                    .accessibilityLabel("경과 시간 \(TimeText.spoken(elapsed))")
            }
        }

        Button {
            Task { await recording.toggle() }
        } label: {
            Label(recording.state.isLive ? "정지" : "녹음 시작", systemImage: recording.state.isLive ? "stop.fill" : "record.circle")
                .frame(maxWidth: .infinity, minHeight: 32)
        }
        .buttonStyle(.borderedProminent)
        .tint(recording.state.isLive ? Theme.textPrimary : Theme.tone(.danger).text)
        .controlSize(.large)
        .disabled(recording.state == .saving)
        .accessibilityIdentifier("hud.record")

        if recording.state.isLive {
            LevelMeter(level: isPaused ? 0 : recording.level)
            HStack {
                Button(isPaused ? "재개" : "일시정지") { Task { await recording.pauseResume() } }
                Button {
                    Task { await recording.addMarker() }
                } label: {
                    Text(recording.markerCount > 0 ? "중요 (\(recording.markerCount))" : "중요")
                }
                .accessibilityHint("지금 이 순간을 중요하다고 표시합니다")
            }
            .buttonStyle(.bordered)
        }

        if let notice = recording.notice {
            Label(notice, systemImage: "speaker.slash")
                .lecternFont(.label)
                .foregroundStyle(Theme.tone(.attention).text)
                .fixedSize(horizontal: false, vertical: true)
        }
        if recording.silenceWarning {
            Label(MacRecordingViewModel.silenceText, systemImage: "mic.slash")
                .lecternFont(.label)
                .foregroundStyle(Theme.tone(.attention).text)
        }
        if case let .failed(message) = recording.state {
            Text(verbatim: message)
                .lecternFont(.label)
                .foregroundStyle(Theme.tone(.danger).text)
                .fixedSize(horizontal: false, vertical: true)
        }

        Picker("저장할 폴더", selection: $services.recordFolderID) {
            Text("폴더 없음").tag(String?.none)
            ForEach(services.folders) { folder in
                Text(verbatim: folder.name).tag(Optional(folder.id))
            }
        }
        .disabled(recording.state.isLive || recording.state == .saving)
    }

    private var isPaused: Bool {
        if case .paused = recording.state { true } else { false }
    }

    private var elapsedMs: Int? {
        switch recording.state {
        case let .recording(ms), let .paused(ms): ms
        default: nil
        }
    }

    private var statusText: String {
        switch recording.state {
        case .recording: "녹음 중"
        case .paused: "일시정지됨"
        case .saving: "저장하는 중"
        case .idle, .failed: "녹음 대기"
        }
    }

    // MARK: - Uploads

    @ViewBuilder
    private var uploadSummary: some View {
        let uploading = services.uploads.filter { $0.state.isRunnable }.count
        let failed = services.uploads.filter { if case .failed = $0.state { true } else { false } }.count
        if uploading > 0 || failed > 0 {
            VStack(alignment: .leading, spacing: LecternTokens.Space.s4) {
                if uploading > 0 {
                    Label("업로드 중 \(uploading)개", systemImage: "arrow.up.circle")
                        .foregroundStyle(Theme.accentText)
                }
                if failed > 0 {
                    Button {
                        services.retryFailedUploads()
                    } label: {
                        Label("실패 \(failed)개 — 다시 시도", systemImage: "exclamationmark.arrow.circlepath")
                    }
                    .buttonStyle(.link)
                    .foregroundStyle(Theme.tone(.danger).text)
                }
            }
            .lecternFont(.label)
        }
    }

    // MARK: - Links

    private var links: some View {
        VStack(alignment: .leading, spacing: LecternTokens.Space.s4) {
            Button("Lectern 열기") { MainWindowOpener.open(openWindow) }
            SettingsLink { Text("설정…") }
                .simultaneousGesture(TapGesture().onEnded { NSApp.activate() })
            Button("종료") { NSApp.terminate(nil) }
        }
        .buttonStyle(.borderless)
    }
}

/// The input level, 0–1.
private struct LevelMeter: View {
    let level: Float

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.textTertiary.opacity(0.25))
                Capsule()
                    .fill(Theme.tone(.success).text)
                    .frame(width: geometry.size.width * CGFloat(min(max(level, 0), 1)))
            }
        }
        .frame(height: 6)
        .accessibilityElement()
        .accessibilityLabel("입력 레벨")
        .accessibilityValue("\(Int((min(max(level, 0), 1) * 100).rounded()))")
    }
}
