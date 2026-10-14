import SwiftUI
import AppIntents
import AVFoundation

/// iOS Action Button / Shortcuts AppIntent:
/// Sends recorded audio from Voice Memos or Shortcuts directly to Lectern and opens the Markdown Reader.
struct DistillLectureIntent: AppIntent {
    static var title: LocalizedStringResource = "강의 녹음 요약 및 노트 열기"
    static var description = IntentDescription("녹음된 강의 오디오에서 쉬는시간을 제거하고 핵심 마크다운 노트를 생성합니다.")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "오디오 파일")
    var audioFile: IntentFile

    @Parameter(title: "과목명", default: "정보보호개론")
    var courseName: String

    func perform() async throws -> some IntentResult & OpensIntent {
        let endpoint = URL(string: "https://lectern.qucord.com/api/ingest/shortcut?wait=false")!
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue("ios-appintent", forHTTPHeaderField: "X-Client")

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"course\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(courseName)\r\n".data(using: .utf8)!)

        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"\(audioFile.filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: audio/mp4\r\n\r\n".data(using: .utf8)!)
        body.append(audioFile.data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body

        let (data, _) = try await URLSession.shared.data(for: req)
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let urlStr = json["url"] as? String,
           let url = URL(string: urlStr) {
            await MainActor.run {
                NotificationCenter.default.post(name: .lecternOpenURL, object: url)
            }
        }
        return .result()
    }
}

extension Notification.Name {
    static let lecternOpenURL = Notification.Name("lecternOpenURL")
}

@main
struct LecternIOSApp: App {
    @State private var currentURL = URL(string: "https://lectern.qucord.com")!

    var body: some Scene {
        WindowGroup {
            LecternWebContainer(url: $currentURL)
                .ignoresSafeArea()
                .preferredColorScheme(.dark)
                .onReceive(NotificationCenter.default.publisher(for: .lecternOpenURL)) { note in
                    if let target = note.object as? URL {
                        currentURL = target
                    }
                }
        }
    }
}
