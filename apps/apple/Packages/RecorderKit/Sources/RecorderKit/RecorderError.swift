import Foundation

/// What the recorder throws. The descriptions are shown to the user as they are.
public enum RecorderError: Error, Equatable, LocalizedError, Sendable {
    /// Less than 200 MB free where the file would go.
    case lowDiskSpace
    /// No input (no microphone permission, or no device): AVAudioEngine reports a 0 Hz format.
    case noInputDevice
    case notIdle
    case notRecording
    /// A buffer whose format is not the file's (AVAudioFile raises an exception instead of throwing).
    case formatMismatch
    /// The file could not be written; what was written so far is kept.
    case failed(String)

    public var errorDescription: String? {
        switch self {
        case .lowDiskSpace: "저장 공간이 부족해 녹음을 시작할 수 없습니다."
        case .noInputDevice: "마이크를 쓸 수 없습니다. 마이크 권한과 연결을 확인하세요."
        case .notIdle: "이미 녹음을 시작했습니다."
        case .notRecording: "녹음 중이 아닙니다."
        case .formatMismatch: "녹음 형식이 맞지 않습니다."
        case let .failed(message): message
        }
    }
}
