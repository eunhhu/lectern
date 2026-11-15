import LecternIntents
import LecternUI
import SwiftUI

/// The recording inside the app: elapsed time, input level, pause/resume, "중요", stop. It is the
/// same session as the Live Activity's, so either one can control it; a stop from the Live
/// Activity closes this screen too.
struct RecordScreen: View {
    @StateObject private var model: RecordModel
    @Environment(\.dismiss) private var dismiss
    /// True when the recording went to the upload queue.
    let onFinished: (Bool) -> Void

    init(session: RecordingSession, draft: RecordingDraft, onFinished: @escaping (Bool) -> Void) {
        _model = StateObject(wrappedValue: RecordModel(session: session, draft: draft))
        self.onFinished = onFinished
    }

    var body: some View {
        VStack(spacing: LecternTokens.Space.s24) {
            if let state = model.state, state.isLive {
                recording(state)
            } else if let message = model.errorMessage {
                Text(verbatim: message)
                    .lecternFont(.body)
                    .foregroundStyle(Theme.tone(.danger).text)
                    .multilineTextAlignment(.center)
                Button("닫기") { dismiss() }
                    .buttonStyle(.bordered)
            } else {
                ProgressView()
                    .accessibilityLabel("녹음을 준비하는 중")
            }
        }
        .padding(LecternTokens.Space.s24)
        .frame(maxWidth: Theme.readingWidth, maxHeight: .infinity)
        .background(Theme.canvas)
        .task { await model.begin() }
        .onChange(of: model.outcome) { _, outcome in
            guard let outcome else { return }
            onFinished(outcome == .queued)
            dismiss()
        }
    }

    @ViewBuilder
    private func recording(_ state: RecordingActivityAttributes.ContentState) -> some View {
        Label {
            Text(verbatim: state.statusText)
        } icon: {
            Image(systemName: state.phase == .recording ? "record.circle.fill" : "pause.circle.fill")
                .foregroundStyle(state.phase == .recording ? Theme.tone(.danger).text : Theme.textSecondary)
        }
        .lecternFont(.title)
        .accessibilityElement(children: .combine)

        Group {
            switch state.elapsedDisplay {
            case let .timer(since):
                Text(timerInterval: since...Date.distantFuture, countsDown: false)
            case let .fixed(text):
                Text(verbatim: text)
            }
        }
        .font(.system(size: 56, weight: .semibold).monospacedDigit())
        .foregroundStyle(Theme.textPrimary)
        .accessibilityLabel("경과 시간")

        LevelBar(level: state.phase == .recording ? model.level : 0)

        if state.silenceWarning {
            Label(RecordingActivityAttributes.silenceText, systemImage: "mic.slash")
                .lecternFont(.label)
                .foregroundStyle(Theme.tone(.attention).text)
        }
        if let message = model.errorMessage {
            Text(verbatim: message)
                .lecternFont(.label)
                .foregroundStyle(Theme.tone(.danger).text)
        }

        Spacer()

        HStack(spacing: LecternTokens.Space.s12) {
            Button {
                Task { await model.togglePause() }
            } label: {
                Label(state.phase == .paused ? "재개" : "일시정지", systemImage: state.phase == .paused ? "play.fill" : "pause.fill")
                    .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
            }
            .buttonStyle(.bordered)

            Button {
                Task { await model.addMarker() }
            } label: {
                Label(state.markerCount > 0 ? "중요 \(state.markerCount)" : "중요", systemImage: "star.fill")
                    .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
            }
            .buttonStyle(.bordered)
            .accessibilityHint("지금 위치를 중요로 표시합니다")

            Button(role: .destructive) {
                Task { await model.stop() }
            } label: {
                Label("정지", systemImage: "stop.fill")
                    .frame(maxWidth: .infinity, minHeight: Theme.minTapTarget)
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.isStopping)
            .accessibilityIdentifier("record.stop")
        }
        .lecternFont(.label)
    }
}

/// The input level, drawn as a filled bar. VoiceOver reads "입력 레벨, 0~100".
private struct LevelBar: View {
    let level: Float

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.raised)
                Capsule().fill(Theme.accent)
                    .frame(width: geometry.size.width * CGFloat(min(1, max(0, level))))
            }
        }
        .frame(height: LecternTokens.Space.s8)
        .accessibilityElement()
        .accessibilityLabel("입력 레벨")
        .accessibilityValue("\(Int((min(1, max(0, level)) * 100).rounded()))")
    }
}

@MainActor
final class RecordModel: ObservableObject {
    enum Outcome: Equatable {
        /// In the upload queue.
        case queued
        /// Too short to keep, or stopped without a file to upload.
        case ended
    }

    @Published private(set) var state: RecordingActivityAttributes.ContentState?
    @Published private(set) var level: Float = 0
    @Published private(set) var errorMessage: String?
    @Published private(set) var outcome: Outcome?
    @Published private(set) var isStopping = false

    private let session: RecordingSession
    private let draft: RecordingDraft
    private var tasks: [Task<Void, Never>] = []
    /// A state from before this screen (a finished recording) must not close it.
    private var sawLive = false

    init(session: RecordingSession, draft: RecordingDraft) {
        self.session = session
        self.draft = draft
    }

    deinit {
        for task in tasks { task.cancel() }
    }

    /// Starts a recording, or joins the one in progress (started from the control or Siri).
    func begin() async {
        let states = session.states
        tasks.append(Task { [weak self] in
            for await state in states {
                await self?.received(state)
            }
        })
        do {
            try await session.start(draft: draft)
        } catch {
            errorMessage = error.localizedDescription
            return
        }
        let levels = await session.levels()
        tasks.append(Task { [weak self] in
            for await level in levels {
                self?.level = level
            }
        })
    }

    func togglePause() async {
        await session.togglePause()
    }

    func addMarker() async {
        await session.addMarker()
    }

    func stop() async {
        isStopping = true
        defer { isStopping = false }
        do {
            let result = try await session.stop()
            if outcome == nil { outcome = result == nil ? .ended : .queued }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func received(_ next: RecordingActivityAttributes.ContentState) async {
        state = next
        if next.isLive {
            sawLive = true
            return
        }
        guard sawLive, outcome == nil, !isStopping else { return }
        // Stopped elsewhere (the Live Activity), or the recording failed.
        if next.phase == .uploading {
            outcome = .queued
        } else if let failure = await session.lastFailure {
            errorMessage = failure
        } else {
            outcome = .ended
        }
    }
}
