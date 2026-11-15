import AppKit
import LecternKit
import LecternUI
import RecorderKit
import SwiftUI

/// ⌘, : the shortcut and the login item (일반), the account and the web pages (계정).
struct SettingsView: View {
    var body: some View {
        TabView {
            GeneralSettings()
                .tabItem { Label("일반", systemImage: "gearshape") }
            AccountSettings()
                .tabItem { Label("계정", systemImage: "person.crop.circle") }
        }
        .frame(width: 480)
    }
}

private struct GeneralSettings: View {
    @EnvironmentObject private var services: MacServices
    @State private var launchAtLogin = LoginItem.isEnabled
    @State private var needsApproval = LoginItem.needsApproval
    @State private var loginItemError: String?
    @AppStorage(MacDefaults.systemAudio) private var systemAudio = false
    @AppStorage(MacDefaults.meetingPrompt) private var meetingPrompt = false

    var body: some View {
        Form {
            Section {
                Toggle("회의 소리도 함께 녹음(시스템 오디오)", isOn: $systemAudio)
                    .onChange(of: systemAudio) { _, on in if on { Self.askSystemAudioPermission() } }
                Text("화상 회의에서 상대방 목소리를 함께 담습니다. 처음 켤 때 macOS가 권한을 묻습니다.")
                    .lecternFont(.caption)
                    .foregroundStyle(Theme.textSecondary)
                Toggle("회의 앱이 실행되면 녹음할지 묻기", isOn: $meetingPrompt)
                    .onChange(of: meetingPrompt) { _, on in if on { services.notifier.askPermissionOnce() } }
                Text("Zoom, Teams, Webex, FaceTime이 실행되면 알림으로 묻습니다. 녹음을 저절로 시작하지는 않습니다.")
                    .lecternFont(.caption)
                    .foregroundStyle(Theme.textSecondary)
            } header: {
                Text("회의")
            }
            Section {
                LabeledContent("녹음 시작·정지") {
                    HotKeyRecorder()
                }
            } footer: {
                Text("다른 앱을 쓰는 중에도 이 단축키로 녹음을 켜고 끕니다.")
                    .lecternFont(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
            Section {
                Toggle("로그인할 때 Lectern 실행", isOn: Binding(get: { launchAtLogin }, set: setLaunchAtLogin))
                if let loginItemError {
                    Text(verbatim: loginItemError)
                        .lecternFont(.caption)
                        .foregroundStyle(Theme.tone(.danger).text)
                }
                if needsApproval {
                    Text(verbatim: LoginItem.needsApprovalText)
                        .lecternFont(.caption)
                        .foregroundStyle(Theme.textSecondary)
                    Button("시스템 설정 열기") { LoginItem.openSystemSettings() }
                }
            }
        }
        .formStyle(.grouped)
        .onAppear(perform: readLoginItem)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in readLoginItem() }
    }

    /// Opens the system audio once for a moment, so macOS asks now rather than in the middle of
    /// the first meeting. Nothing is kept.
    private static func askSystemAudioPermission() {
        DispatchQueue.global(qos: .userInitiated).async {
            let tap = SystemAudioTap()
            try? tap.start(onSamples: { _ in })
            tap.stop()
        }
    }

    private func readLoginItem() {
        launchAtLogin = LoginItem.isEnabled || LoginItem.needsApproval
        needsApproval = LoginItem.needsApproval
    }

    /// On failure the toggle goes back to what the system says.
    private func setLaunchAtLogin(_ enabled: Bool) {
        do {
            try LoginItem.set(enabled)
            loginItemError = nil
        } catch {
            loginItemError = LoginItem.failedText
        }
        readLoginItem()
    }
}

/// Shows the shortcut; a click listens for the next key combination (esc cancels).
private struct HotKeyRecorder: View {
    @EnvironmentObject private var services: MacServices
    @State private var listening = false
    @State private var error: String?
    @State private var monitor: Any?
    @State private var combo = HotKeyCombo.load(from: .standard)

    var body: some View {
        VStack(alignment: .trailing, spacing: LecternTokens.Space.s4) {
            Button(listening ? "새 조합을 누르세요" : combo.displayString) {
                listening ? stopListening(restore: true) : startListening()
            }
            .accessibilityLabel(listening ? "새 단축키를 누르세요. 취소하려면 esc" : "단축키 \(combo.displayString), 바꾸기")
            if let message = error ?? services.hotKeyError {
                Text(verbatim: message)
                    .lecternFont(.caption)
                    .foregroundStyle(Theme.tone(.danger).text)
                    .multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .onDisappear { stopListening(restore: true) }
    }

    private func startListening() {
        error = nil
        listening = true
        services.suspendHotKey(true)
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            MainActor.assumeIsolated { received(event) }
            return nil
        }
    }

    private func received(_ event: NSEvent) {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if event.keyCode == 0x35, flags.subtracting([.capsLock, .function]).isEmpty {  // esc
            stopListening(restore: true)
            return
        }
        let next = HotKeyCombo(
            keyCode: UInt32(event.keyCode),
            command: flags.contains(.command),
            shift: flags.contains(.shift),
            option: flags.contains(.option),
            control: flags.contains(.control)
        )
        stopListening(restore: false)
        if services.setHotKey(next) {
            combo = next
        } else {
            error = GlobalHotKey.unavailableText
        }
    }

    private func stopListening(restore: Bool) {
        guard listening else { return }
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        listening = false
        if restore { services.suspendHotKey(false) }
    }
}

/// The account, the server, the version, sign out, and the pages that live on the web.
private struct AccountSettings: View {
    @EnvironmentObject private var services: MacServices
    @Environment(\.openURL) private var openURL
    @State private var confirmSignOut = false

    private var server: URL { services.environment.serverURL }

    var body: some View {
        Form {
            Section {
                LabeledContent("이메일", value: services.me?.email ?? "—")
                LabeledContent("서버 주소", value: server.absoluteString)
                LabeledContent("앱 버전", value: Self.version)
            } footer: {
                Text("서버를 바꾸려면 로그아웃한 뒤 로그인 화면의 서버 주소에서 바꿉니다.")
                    .lecternFont(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
            if services.session == .signedIn {
                Section {
                    Button("로그아웃", role: .destructive) { confirmSignOut = true }
                        .confirmationDialog("로그아웃할까요? 올리지 못한 녹음은 이 Mac에 남습니다.", isPresented: $confirmSignOut) {
                            Button("로그아웃", role: .destructive) { Task { await services.signOut() } }
                            Button("취소", role: .cancel) {}
                        }
                }
            }
            Section {
                Button("계정 삭제 (웹에서 열기)") { openURL(Self.page(server, "app/settings", fragment: "account")) }
                Button("개인정보처리방침") { openURL(Self.page(server, "privacy")) }
                Button("이용약관") { openURL(Self.page(server, "terms")) }
            }
        }
        .formStyle(.grouped)
    }

    static var version: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let short = info["CFBundleShortVersionString"] as? String ?? "?"
        let build = info["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }

    static func page(_ server: URL, _ path: String, fragment: String? = nil) -> URL {
        var components = URLComponents(url: server.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        components.fragment = fragment
        return components.url!
    }
}
