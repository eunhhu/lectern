import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Adds the credential to every request. After a 401 it asks the provider for a new token and
/// sends the request once more, never twice. A streamed body (a part upload) cannot be sent
/// again: its 401 goes back to the caller.
struct AuthMiddleware: ClientMiddleware {
    let auth: AuthProvider

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let (first, sent) = try await authorized(request, baseURL)
        let (response, responseBody) = try await next(first, body, baseURL)
        guard response.status.code == 401, body?.iterationBehavior != .single else { return (response, responseBody) }
        // Another request may have refreshed while this one was out: then just use the new token.
        let (_, current) = try await authorized(request, baseURL)
        if current == sent {
            guard try await auth.refreshAfterUnauthorized() else { return (response, responseBody) }
        }
        let (retry, _) = try await authorized(request, baseURL)
        return try await next(retry, body, baseURL)
    }

    /// The request with the provider's headers, and those headers.
    private func authorized(_ request: HTTPRequest, _ baseURL: URL) async throws -> (HTTPRequest, [String: String]) {
        var scratch = URLRequest(url: baseURL)
        try await auth.authorize(&scratch)
        let fields = scratch.allHTTPHeaderFields ?? [:]
        var copy = request
        for (name, value) in fields {
            if let field = HTTPField.Name(name) { copy.headerFields[field] = value }
        }
        return (copy, fields)
    }
}
