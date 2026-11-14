import LecternKit
import LecternUI
import SwiftUI

/// Sign-in in the main window: email and password, or an API token, and the server address.
struct LoginView: View {
    @EnvironmentObject private var services: MacServices

    var body: some View {
        // A new model per client: changing the server makes a new client.
        LoginForm(model: LoginViewModel(client: services.client, onSignedIn: { [weak services] me in services?.signedIn(me) }))
            .id(services.environment.serverURL)
    }
}

private struct LoginForm: View {
    @EnvironmentObject private var services: MacServices
    @StateObject var model: LoginViewModel
    @State private var showServer = false
    @State private var serverText = ""
    @State private var serverError: String?

    var body: some View {
        Form {
            Section {
                if model.method == .password {
                    TextField("이메일", text: $model.email)
                        .textContentType(.username)
                        .autocorrectionDisabled()
                    SecureField("비밀번호", text: $model.password)
                        .textContentType(.password)
                } else {
                    SecureField("API 토큰", text: $model.apiToken)
                        .autocorrectionDisabled()
                }
                if let message = model.errorMessage {
                    Text(verbatim: message)
                        .lecternFont(.caption)
                        .foregroundStyle(Theme.tone(.danger).text)
                }
                HStack {
                    Button("로그인") { Task { await model.submit() } }
                        .keyboardShortcut(.defaultAction)
                        .disabled(!model.canSubmit)
                    if model.isWorking { ProgressView().controlSize(.small) }
                }
            } header: {
                Text("Lectern에 로그인")
                    .lecternFont(.title)
            }

            Section {
                DisclosureGroup("서버 주소", isExpanded: $showServer) {
                    TextField("https://", text: $serverText)
                        .autocorrectionDisabled()
                    if let serverError {
                        Text(verbatim: serverError)
                            .lecternFont(.caption)
                            .foregroundStyle(Theme.tone(.danger).text)
                    }
                    Button("이 주소로 바꾸기") {
                        Task {
                            serverError = await services.setServerURL(serverText) ? nil : ScreenText.invalidServerURL
                        }
                    }
                }
                Button(model.method == .password ? "API 토큰으로 로그인" : "이메일로 로그인") {
                    model.method = model.method == .password ? .apiToken : .password
                }
                .buttonStyle(.link)
            } footer: {
                Text("API 토큰은 이메일 로그인을 아직 지원하지 않는 서버에서 씁니다. 웹의 설정에서 만들 수 있습니다.")
                    .lecternFont(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .formStyle(.grouped)
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { serverText = services.environment.serverURL.absoluteString }
    }
}
