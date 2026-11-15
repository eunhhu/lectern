import Foundation
import OpenAPIRuntime

extension LecternAPI: PushAPI {
    public func upsertPushDevice(deviceID: String, registration: PushDeviceRegistration) async throws {
        var name: String?
        if let full = registration.name, !full.isEmpty { name = String(full.prefix(100)) }
        var version: String?
        if let full = registration.appVersion, !full.isEmpty { version = String(full.prefix(40)) }
        let body = Components.Schemas.UpsertPushDeviceRequest(
            platform: "ios",
            apns_token: registration.apnsToken,
            push_to_start_token: registration.pushToStartToken,
            name: name,
            app_version: version
        )
        let input = Operations.upsertPushDevice.Input(path: .init(device_id: deviceID), body: .json(body))
        try await run {
            _ = try await client.upsertPushDevice(input).ok
        }
    }

    public func deletePushDevice(deviceID: String) async throws {
        try await run {
            _ = try await client.deletePushDevice(.init(path: .init(device_id: deviceID))).noContent
        }
    }

    public func setLiveActivity(recordingID: String, deviceID: String, pushToken: String) async throws {
        try await run {
            _ = try await client.setLiveActivity(.init(
                path: .init(recording_id: recordingID),
                body: .json(.init(device_id: deviceID, push_token: pushToken))
            )).noContent
        }
    }

    public func endLiveActivity(recordingID: String, deviceID: String) async throws {
        try await run {
            _ = try await client.endLiveActivity(.init(path: .init(recording_id: recordingID), query: .init(device_id: deviceID))).noContent
        }
    }
}

extension LecternAPI {
    /// The calendar events found in a recording (every page). Read without the generated
    /// client: its decoder refuses an event kind or status this app does not know yet.
    public func events(recordingID: String) async throws -> [EventCandidateModel] {
        var items: [EventCandidateModel] = []
        var cursor: String?
        for _ in 0..<10 {
            var query = [URLQueryItem(name: "limit", value: "100")]
            if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
            let data = try await getJSON(["recordings", recordingID, "events"], query: query)
            let page: EventPage
            do {
                page = try Self.lenientDecoder.decode(EventPage.self, from: data)
            } catch {
                throw APIError.decoding(String(describing: error))
            }
            items += page.items.compactMap(\.value)
            guard let next = page.next_cursor else { break }
            cursor = next
        }
        return items
    }

    /// A GET with the credential, sent once more after a refreshed 401.
    func getJSON(_ path: [String], query: [URLQueryItem]) async throws -> Data {
        var url = Self.apiBase(serverURL)
        for part in path { url.appendPathComponent(part) }
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { throw APIError.decoding("url") }
        components.queryItems = query.isEmpty ? nil : query
        guard let target = components.url else { throw APIError.decoding("url") }
        for attempt in 0..<2 {
            var request = URLRequest(url: target)
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            try await auth.authorize(&request)
            let data: Data
            let response: URLResponse
            do {
                (data, response) = try await session.data(for: request)
            } catch {
                throw Self.apiError(error)
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 401, attempt == 0, try await auth.refreshAfterUnauthorized() { continue }
            guard (200..<300).contains(status) else { throw APIError.from(status: status, body: data) }
            return data
        }
        throw APIError.unauthorized
    }

    private struct EventPage: Decodable {
        let items: [Lenient<EventCandidateModel>]
        let next_cursor: String?
    }

    /// One item that fails to decode is skipped, not the page.
    private struct Lenient<T: Decodable>: Decodable {
        let value: T?
        init(from decoder: Decoder) throws {
            value = try? T(from: decoder)
        }
    }

    static let lenientDecoder: JSONDecoder = {
        let decoder = JSONDecoder()
        let transcoder = LenientISO8601DateTranscoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            return try transcoder.decode(text)
        }
        return decoder
    }()
}
