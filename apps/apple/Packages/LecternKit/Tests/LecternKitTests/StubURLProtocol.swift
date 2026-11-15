import Foundation

/// Answers URLSession requests from a handler and records them: no request leaves the process.
/// Tests install it with `StubURLProtocol.session()`.
final class StubURLProtocol: URLProtocol {
    struct Reply {
        var status: Int
        var body: Data
        var headers: [String: String] = ["Content-Type": "application/json"]
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler: (URLRequest) -> Reply = { _ in Reply(status: 500, body: Data()) }
    nonisolated(unsafe) private static var recorded: [URLRequest] = []

    static func reset(_ next: @escaping (URLRequest) -> Reply) {
        lock.lock()
        defer { lock.unlock() }
        handler = next
        recorded = []
    }

    static var requests: [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.recorded.append(request)
        let handler = Self.handler
        Self.lock.unlock()
        let reply = handler(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
