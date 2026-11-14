import Foundation
import LecternKit

/// Where a screen's content is.
public enum Phase: Equatable, Sendable {
    case loading, loaded, empty
    case failed(String)
}

/// The sentences screens show, in one place (tested).
public enum ScreenText {
    public static let connectionFailed = "서버에 연결하지 못했습니다. 서버 주소와 네트워크를 확인해 주세요."
    public static let wrongPassword = "이메일 또는 비밀번호가 올바르지 않습니다."
    public static let wrongToken = "API 토큰이 올바르지 않습니다."
    public static let tooMany = "잠시 뒤 다시 시도해 주세요."
    public static let useApiToken = "이 서버는 이메일 로그인을 아직 지원하지 않습니다. API 토큰으로 로그인해 주세요."
    public static let noRecordings = "아직 녹음이 없습니다."
    public static let processing = "처리 중입니다. 끝나면 문서가 여기에 나타납니다."
    public static let failed = "처리하지 못했습니다."
    public static let transcriptOnly = "노트를 만들지 못했습니다. 전사는 볼 수 있습니다."
    public static let invalidServerURL = "http:// 또는 https://로 시작하는 주소를 넣어 주세요."

    /// What to tell the user about a failed request (the server's own sentence when it sent one).
    public static func message(for error: Error) -> String {
        guard let api = error as? APIError else { return connectionFailed }
        switch api {
        case .transport: return connectionFailed
        case let .quotaExceeded(message): return message
        case .server(status: 429, _, _): return tooMany
        case let .server(_, _, message): return message ?? "문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요."
        case .notFound: return "찾을 수 없습니다. 지워졌을 수 있습니다."
        case .forbidden: return "볼 권한이 없습니다."
        case .unauthorized: return "다시 로그인해 주세요."
        case .decoding: return "서버의 답을 읽지 못했습니다. 앱을 업데이트해 주세요."
        }
    }

    /// A request the screen itself cancelled (it went away, or a refresh replaced it): not an error.
    public static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        if case let .transport(code) = error as? APIError { return code == String(URLError.cancelled.rawValue) }
        return false
    }

    /// The list's status mark: nothing for a ready recording.
    public static func statusLabel(_ status: RecordingStatus) -> String? {
        switch status {
        case .uploading, .queued, .processing: "처리 중"
        case .partial: "전사만 준비됨"
        case .failed: "실패"
        case .canceled: "취소됨"
        case .ready, .unknown: nil
        }
    }

    /// "1시간 23분", "23분", "45초".
    public static func duration(_ ms: Int?) -> String? {
        guard let ms, ms > 0 else { return nil }
        let total = ms / 1000
        let h = total / 3600
        let m = (total % 3600) / 60
        if h > 0 { return m > 0 ? "\(h)시간 \(m)분" : "\(h)시간" }
        if m > 0 { return "\(m)분" }
        return "\(total)초"
    }

    /// "2026년 10월 19일 오후 2:30" in the given time zone.
    public static func recordedAt(_ date: Date, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy년 M월 d일 a h:mm"
        return formatter.string(from: date)
    }

    /// A list row for VoiceOver: `<제목>, <날짜>, <길이>, <상태>` (missing parts left out).
    public static func rowAccessibilityLabel(_ recording: RecordingSummary, timeZone: TimeZone = .current) -> String {
        [recording.title, recordedAt(recording.recordedAt, timeZone: timeZone), duration(recording.durationMs), statusLabel(recording.status)]
            .compactMap { $0 }
            .joined(separator: ", ")
    }

    /// An upload queue entry's state.
    public static func uploadState(_ state: UploadJob.State) -> String {
        switch state {
        case .queued: "대기 중"
        case .uploading: "올리는 중"
        case .completing: "마무리 중"
        case .waitingForNetwork: "네트워크를 기다리는 중"
        case .done: "올림"
        case let .failed(message): message
        }
    }
}
