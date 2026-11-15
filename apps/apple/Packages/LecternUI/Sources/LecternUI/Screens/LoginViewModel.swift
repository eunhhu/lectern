import Foundation
import LecternKit

/// Sign in with email and password (native tokens), or with a pasted API token on a server
/// without native sign-in. The server answering 501/404 on the native route switches the screen
/// to the API token form.
@MainActor
public final class LoginViewModel: ObservableObject {
    public enum Method: Equatable, Sendable {
        case password, apiToken
    }

    @Published public var email = ""
    @Published public var password = ""
    @Published public var apiToken = ""
    @Published public var method: Method = .password
    @Published public private(set) var isWorking = false
    @Published public private(set) var errorMessage: String?

    private let client: LecternClient
    private let onSignedIn: @MainActor (Me) -> Void

    public init(client: LecternClient, onSignedIn: @escaping @MainActor (Me) -> Void) {
        self.client = client
        self.onSignedIn = onSignedIn
    }

    public var canSubmit: Bool {
        guard !isWorking else { return false }
        switch method {
        case .password: return !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
        case .apiToken: return !apiToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    public func submit() async {
        guard canSubmit else { return }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let me: Me
            switch method {
            case .password: me = try await client.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
            case .apiToken: me = try await client.signIn(apiToken: apiToken)
            }
            password = ""
            apiToken = ""
            onSignedIn(me)
        } catch LoginError.nativeSignInUnavailable {
            method = .apiToken
            errorMessage = ScreenText.useApiToken
        } catch {
            errorMessage = Self.message(for: error, method: method)
        }
    }

    nonisolated static func message(for error: Error, method: Method) -> String {
        if case APIError.unauthorized = error {
            return method == .password ? ScreenText.wrongPassword : ScreenText.wrongToken
        }
        return ScreenText.message(for: error)
    }
}
