import LecternKit
import LecternUI
import SwiftUI

/// Account, server, version, sign out, and the pages that live on the web (account deletion,
/// privacy, terms), opened in Safari: the app has no web views.
struct SettingsScreen: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var confirmSignOut = false

    private var server: URL { app.environment.serverURL }

    var body: some View {
        NavigationStack {
            Form {
                Section("계정") {
                    LabeledContent("이메일", value: app.me?.email ?? "—")
                }
                Section {
                    LabeledContent("서버 주소", value: server.absoluteString)
                } footer: {
                    Text("서버를 바꾸려면 로그아웃한 뒤 로그인 화면의 서버 주소에서 바꿉니다.")
                        .lecternFont(.caption)
                }
                Section {
                    LabeledContent("앱 버전", value: Self.version)
                }
                Section {
                    Button("로그아웃", role: .destructive) { confirmSignOut = true }
                        .confirmationDialog("로그아웃할까요? 올리지 못한 녹음은 기기에 남습니다.", isPresented: $confirmSignOut, titleVisibility: .visible) {
                            Button("로그아웃", role: .destructive) {
                                Task {
                                    await app.signOut()
                                    dismiss()
                                }
                            }
                            Button("취소", role: .cancel) {}
                        }
                }
                Section {
                    Button("웹에서 열기") { openURL(Self.page(server, "app/settings", fragment: "account")) }
                        .accessibilityLabel("계정 삭제, 웹에서 열기")
                } header: {
                    Text("계정 삭제")
                } footer: {
                    Text("계정 삭제는 웹에서 요청합니다.")
                        .lecternFont(.caption)
                }
                Section {
                    Button("개인정보처리방침") { openURL(Self.page(server, "privacy")) }
                    Button("이용약관") { openURL(Self.page(server, "terms")) }
                }
            }
            .navigationTitle("설정")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("닫기") { dismiss() }
                }
            }
        }
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
