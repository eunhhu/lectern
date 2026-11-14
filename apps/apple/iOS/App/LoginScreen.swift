import LecternKit
import LecternUI
import SwiftUI

struct LoginScreen: View {
    @EnvironmentObject private var app: AppModel

    var body: some View {
        // A new model per client: changing the server makes a new client.
        LoginForm(model: LoginViewModel(client: app.client, onSignedIn: { me in app.signedIn(me) }))
            .id(app.environment.serverURL)
    }
}

private struct LoginForm: View {
    @EnvironmentObject private var app: AppModel
    @StateObject var model: LoginViewModel
    @State private var showServer = false
    @State private var serverText = ""
    @State private var serverError: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if model.method == .password {
                        TextField("이메일", text: $model.email)
                            .textContentType(.username)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField("비밀번호", text: $model.password)
                            .textContentType(.password)
                    } else {
                        SecureField("API 토큰", text: $model.apiToken)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    if let message = model.errorMessage {
                        Text(verbatim: message)
                            .lecternFont(.caption)
                            .foregroundStyle(Theme.tone(.danger).text)
                    }
                    Button {
                        Task { await model.submit() }
                    } label: {
                        HStack {
                            Text("로그인")
                            if model.isWorking { ProgressView() }
                        }
                    }
                    .disabled(!model.canSubmit)
                }

                Section {
                    DisclosureGroup("서버 주소", isExpanded: $showServer) {
                        TextField("https://", text: $serverText)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        if let serverError {
                            Text(verbatim: serverError)
                                .lecternFont(.caption)
                                .foregroundStyle(Theme.tone(.danger).text)
                        }
                        Button("이 주소로 바꾸기") {
                            Task {
                                serverError = await app.setServerURL(serverText) ? nil : ScreenText.invalidServerURL
                            }
                        }
                    }
                    Button(model.method == .password ? "API 토큰으로 로그인" : "이메일로 로그인") {
                        model.method = model.method == .password ? .apiToken : .password
                    }
                } footer: {
                    Text("API 토큰은 이메일 로그인을 아직 지원하지 않는 서버에서 씁니다. 웹의 설정에서 만들 수 있습니다.")
                        .lecternFont(.caption)
                }
            }
            .navigationTitle("Lectern")
            .onAppear { serverText = app.environment.serverURL.absoluteString }
        }
    }
}
