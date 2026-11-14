import Foundation
import HTTPTypes
import OpenAPIRuntime

/// What a LecternAPI call throws. Server error bodies (`{ "error": { "code", "message" } }`)
/// become these cases; `quota_exceeded` carries the server's Korean sentence as is.
public enum APIError: Error, Equatable, Sendable {
    case unauthorized
    case forbidden
    case notFound
    case quotaExceeded(message: String)
    case server(status: Int, code: String?, message: String?)
    case transport(String)
    case decoding(String)

    /// The error for a non-2xx response and its body.
    static func from(status: Int, body: Data?) -> APIError {
        var code: String?
        var message: String?
        if let body,
           let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
           let error = object["error"] as? [String: Any] {
            code = error["code"] as? String
            message = error["message"] as? String
        }
        if code == "quota_exceeded" { return .quotaExceeded(message: message ?? "") }
        switch status {
        case 401: return .unauthorized
        case 403: return .forbidden
        case 404: return .notFound
        default: return .server(status: status, code: code, message: message)
        }
    }
}

/// Turns every non-2xx response into an `APIError`, so each operation only handles `.ok`.
/// Outermost middleware: it sees the answer after AuthMiddleware's retry.
struct ErrorMiddleware: ClientMiddleware {
    static let maxErrorBody = 1 << 20

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let (response, responseBody) = try await next(request, body, baseURL)
        guard !(200..<300).contains(response.status.code) else { return (response, responseBody) }
        var data: Data?
        if let responseBody {
            data = try? await Data(collecting: responseBody, upTo: Self.maxErrorBody)
        }
        throw APIError.from(status: response.status.code, body: data)
    }
}
