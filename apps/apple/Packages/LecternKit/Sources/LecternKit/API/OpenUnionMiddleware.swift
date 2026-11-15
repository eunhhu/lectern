import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Every union of packages/domain is open: a newer server may send a block `type` or a source
/// `kind` this app does not know, and the app shows it as nothing (D-P6-7, domain README).
/// The generated decoder throws on such values, so before it runs:
/// - a block of an unknown type becomes a placeholder paragraph whose id records the type
///   (`DocumentBlock.unknown` in the models);
/// - a source of an unknown kind is dropped.
struct OpenUnionMiddleware: ClientMiddleware {
    /// Operations whose bodies carry document blocks or sources. A method that exposes another
    /// one (events, action items: `evidence`) adds it here with the keys its unions sit under.
    static let operations: Set<String> = ["getDocument"]
    static let maxBody = 64 << 20

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let (response, responseBody) = try await next(request, body, baseURL)
        guard Self.operations.contains(operationID), (200..<300).contains(response.status.code), let responseBody else {
            return (response, responseBody)
        }
        let data = try await Data(collecting: responseBody, upTo: Self.maxBody)
        return (response, HTTPBody(OpenUnion.sanitize(data)))
    }
}

enum OpenUnion {
    static let blockTypes: Set<String> = ["paragraph", "list", "quote", "term", "formula", "callout", "gap"]
    static let sourceKinds: Set<String> = ["transcript", "pdf_page"]
    /// Prefix of a placeholder block's id; the unknown type follows it.
    static let unknownBlockPrefix = "lectern.unknown-block:"

    /// The JSON with unknown blocks replaced and unknown sources dropped (unchanged when it is
    /// not JSON).
    static func sanitize(_ data: Data) -> Data {
        guard let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]),
              let out = try? JSONSerialization.data(withJSONObject: clean(object), options: [.fragmentsAllowed])
        else { return data }
        return out
    }

    private static func clean(_ value: Any) -> Any {
        if let array = value as? [Any] { return array.map(clean) }
        guard let object = value as? [String: Any] else { return value }
        var out: [String: Any] = [:]
        for (key, child) in object {
            switch (key, child) {
            case let ("blocks", blocks as [Any]):
                out[key] = blocks.map(block)
            case let ("sources", sources as [Any]):
                out[key] = sources.filter { ($0 as? [String: Any])?["kind"].flatMap { $0 as? String }.map(sourceKinds.contains) ?? false }
            default:
                out[key] = clean(child)
            }
        }
        return out
    }

    private static func block(_ value: Any) -> Any {
        guard let object = value as? [String: Any] else { return value }
        let type = object["type"] as? String ?? ""
        if blockTypes.contains(type) { return clean(object) }
        return ["type": "paragraph", "id": unknownBlockPrefix + type, "heading": NSNull(), "text": "", "sources": [Any]()] as [String: Any]
    }
}
