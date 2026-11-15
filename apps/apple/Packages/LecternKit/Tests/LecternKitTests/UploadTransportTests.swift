import XCTest
@testable import LecternKit

/// LecternUploadTransport over a stubbed URLSession: what create sends, and that a part carries
/// exactly its byte range.
final class UploadTransportTests: XCTestCase {
    let server = URL(string: "https://lectern.test")!

    func transport() -> LecternUploadTransport {
        let api = LecternAPI(serverURL: server, auth: ApiTokenProvider(store: InMemoryTokenStore([TokenKey.apiToken: "t"])), session: StubURLProtocol.session())
        return LecternUploadTransport(api: api)
    }

    static let session = Data(#"""
    {"id":"upl_1","workspace_id":"ws","recording_id":null,"status":"open","recorded_at":null,"part_size":4,
     "files":[{"kind":"audio","filename":"a.m4a","mime":"audio/mp4","bytes":10,"index":0,"first_part":1,"part_count":3}],
     "received_parts":[1],"created_at":"2026-10-19T05:30:00.000Z","expires_at":"2026-10-20T05:30:00.000Z"}
    """#.utf8)

    /// The body URLSession handed to the protocol (a stream for uploads). A streamed body is a
    /// bound pair the client fills from another thread: "no bytes yet" is not the end, so this
    /// reads until the stream ends, the declared Content-Length arrived, or 5 s passed.
    static func body(of request: URLRequest) -> Data {
        if let data = request.httpBody { return data }
        guard let stream = request.httpBodyStream else { return Data() }
        let expected = request.value(forHTTPHeaderField: "Content-Length").flatMap(Int.init)
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            if let expected, data.count >= expected { break }
            switch stream.streamStatus {
            case .atEnd, .closed, .error: return data
            default: break
            }
            guard stream.hasBytesAvailable else {
                Thread.sleep(forTimeInterval: 0.005)
                continue
            }
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }

    func testRecordedAtIsSent() async throws {
        var bodies: [Data] = []
        let lock = NSLock()
        StubURLProtocol.reset { request in
            lock.withLock { bodies.append(Self.body(of: request)) }
            return .init(status: 201, body: Self.session)
        }
        let recordedAt = Date(timeIntervalSince1970: 1_792_387_800)  // 2026-10-19T05:30:00Z
        var job = UploadJob(fileRelativePath: "a.m4a", fileName: "a.m4a", mimeType: "audio/mp4", byteCount: 10, workspaceID: "ws", title: "자료구조", recordedAt: recordedAt)
        job.folderID = "folder-1"
        let info = try await transport().create(job, files: [.init(kind: .audio, fileName: "a.m4a", mimeType: "audio/mp4", byteCount: 10)])
        XCTAssertEqual(info, UploadSessionInfo(uploadID: "upl_1", partSize: 4, files: [.init(index: 0, firstPart: 1, partCount: 3)], partsDone: [1]))
        let request = StubURLProtocol.requests[0]
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v2/uploads")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), job.id)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: lock.withLock { bodies[0] }) as? [String: Any])
        let sent = try XCTUnwrap(json["recorded_at"] as? String)
        XCTAssertTrue(sent.hasPrefix("2026-10-19T05:30:00"), sent)
        XCTAssertTrue(sent.hasSuffix("Z"), sent)
        XCTAssertEqual((json["recording"] as? [String: Any])?["title"] as? String, "자료구조")
        XCTAssertEqual((json["files"] as? [[String: Any]])?.first?["bytes"] as? Int, 10)
    }

    func testPartCarriesItsRange() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("part-\(UUID().uuidString).bin")
        try Data((0..<10).map { UInt8($0) }).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        var body = Data()
        let lock = NSLock()
        StubURLProtocol.reset { request in
            lock.withLock { body = Self.body(of: request) }
            return .init(status: 200, body: Data(#"{"part":2,"bytes":4,"sha256":"\#(String(repeating: "a", count: 64))"}"#.utf8))
        }
        try await transport().putPart(uploadID: "upl_1", part: 2, fileURL: file, range: 4..<8)
        let request = StubURLProtocol.requests[0]
        XCTAssertEqual(request.httpMethod, "PUT")
        XCTAssertEqual(request.url?.path, "/api/v2/uploads/upl_1/parts/2")
        XCTAssertEqual(lock.withLock { body }, Data([4, 5, 6, 7]))
    }

    func testRangeReaderReadsInChunks() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("range-\(UUID().uuidString).bin")
        try Data((0..<100).map { UInt8($0) }).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let reader = try RangeReader(fileURL: file, range: 10..<35, readSize: 8)
        var chunks: [ArraySlice<UInt8>] = []
        while let chunk = try reader.next() { chunks.append(chunk) }
        XCTAssertEqual(chunks.map(\.count), [8, 8, 8, 1])
        XCTAssertEqual(Data(chunks.joined()), Data((10..<35).map { UInt8($0) }))
    }

    func testCreateBodyIsStableAcrossRestarts() async throws {
        // The server compares the create body under the key: a relaunch must send the same one.
        var bodies: [Data] = []
        let lock = NSLock()
        StubURLProtocol.reset { request in
            lock.withLock { bodies.append(Self.body(of: request)) }
            return .init(status: 201, body: Self.session)
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("stable-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let job = UploadJob(
            fileRelativePath: "a.m4a", fileName: "a.m4a", mimeType: "audio/mp4", byteCount: 10, workspaceID: "ws",
            recordedAt: Date(timeIntervalSince1970: 1_792_387_800.7654321)
        )
        let files: [LecternKit.UploadFileSpec] = [.init(kind: .audio, fileName: "a.m4a", mimeType: "audio/mp4", byteCount: 10)]
        _ = try await transport().create(job, files: files)
        let store = UploadQueueStore(directory: directory)
        try store.save(job)
        let reloaded = try XCTUnwrap(UploadQueueStore(directory: directory).load().first)
        _ = try await transport().create(reloaded, files: files)
        let sent = lock.withLock { bodies }.map { try! JSONSerialization.jsonObject(with: $0) as! [String: Any] }
        XCTAssertEqual(sent.count, 2)
        XCTAssertEqual(sent[0]["recorded_at"] as? String, "2026-10-19T05:30:00.000Z")
        XCTAssertEqual(sent[1]["recorded_at"] as? String, sent[0]["recorded_at"] as? String)
        XCTAssertEqual(lock.withLock { bodies[0] == bodies[1] }, true)
    }
}

