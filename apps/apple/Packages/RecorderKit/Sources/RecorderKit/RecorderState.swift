import Foundation

/// Where a recording is. Only `reduce` changes it.
public enum RecorderState: Equatable, Sendable {
    case idle
    case recording
    case paused(reason: PauseReason)
    case stopping
    case finished
    case failed(message: String)
}

public enum PauseReason: Equatable, Sendable {
    /// The user paused; only the user resumes.
    case user
    /// A call or another app took the audio session.
    case interruption
    /// The input device went away (AirPods taken out).
    case routeLost
}

public enum RecorderEvent: Equatable, Sendable {
    case start, pause, resume, stop
    case interruptionBegan
    case interruptionEnded(shouldResume: Bool)
    case routeLost, routeRestored
    case sinkFailed(String)
    case finishedWriting
}

/// The transition table of P6-A4. A pair that is not in it leaves the state as it is; a pause
/// the user made is never undone by the system (interruption end, route restored).
public func reduce(_ state: RecorderState, _ event: RecorderEvent) -> RecorderState {
    switch (state, event) {
    case (.idle, .start):
        return .recording
    case (.recording, .pause):
        return .paused(reason: .user)
    case (.recording, .interruptionBegan):
        return .paused(reason: .interruption)
    case (.recording, .routeLost):
        return .paused(reason: .routeLost)
    case (.paused(.user), .resume):
        return .recording
    case (.paused(.interruption), .interruptionEnded(let shouldResume)):
        return shouldResume ? .recording : .paused(reason: .user)
    case (.paused(.interruption), .resume):
        return .recording
    case (.paused(.routeLost), .routeRestored), (.paused(.routeLost), .resume):
        return .recording
    case (.recording, .stop), (.paused, .stop):
        return .stopping
    case (.stopping, .finishedWriting):
        return .finished
    case (.recording, .sinkFailed(let message)), (.paused, .sinkFailed(let message)), (.stopping, .sinkFailed(let message)):
        return .failed(message: message)
    default:
        return state
    }
}
