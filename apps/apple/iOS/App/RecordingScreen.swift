import LecternKit
import LecternUI
import SwiftUI

/// One recording: title, 문서/전사 tabs (side by side on a wide iPad), the player at the bottom.
struct RecordingScreen: View {
    @EnvironmentObject private var app: AppModel
    let recordingID: String

    var body: some View {
        RecordingContent(model: makeModel(), recordingID: recordingID, client: app.client, server: app.environment.serverURL)
    }

    private func makeModel() -> RecordingViewModel {
        let model = RecordingViewModel(recordingID: recordingID, client: app.client)
        model.onUnauthorized = { [weak app] in app?.sessionExpired() }
        return model
    }
}

private struct RecordingContent: View {
    @StateObject var model: RecordingViewModel
    let recordingID: String
    let client: LecternClient
    let server: URL
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var events: [EventCandidateModel] = []
    @State private var showEvents = false

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                switch model.phase {
                case .loading:
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityLabel("불러오는 중")
                case let .failed(message):
                    VStack(spacing: LecternTokens.Space.s12) {
                        Text(verbatim: message)
                            .lecternFont(.body)
                            .foregroundStyle(Theme.tone(.danger).text)
                        Button("다시 시도") { Task { await model.load() } }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .loaded, .empty:
                    if sizeClass == .regular && geometry.size.width >= 900 {
                        HStack(spacing: 0) {
                            documentPane
                            Divider()
                            transcriptPane
                        }
                    } else {
                        Picker("보기", selection: $model.tab) {
                            Text("문서").tag(RecordingViewModel.Tab.document)
                            Text("전사").tag(RecordingViewModel.Tab.transcript)
                        }
                        .pickerStyle(.segmented)
                        .padding(.horizontal, LecternTokens.Space.s16)
                        .padding(.vertical, LecternTokens.Space.s8)
                        if model.tab == .document { documentPane } else { transcriptPane }
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if model.detail?.audioAssetID != nil {
                PlayerBar(model: model.player)
            }
        }
        .navigationTitle(model.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(verbatim: model.title)
                    .lecternFont(.title)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("recording.title")
            }
            if !events.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showEvents = true } label: { Label("일정 \(events.count)개", systemImage: "calendar") }
                        .accessibilityLabel("일정 \(events.count)개")
                }
            }
        }
        .sheet(isPresented: $showEvents) { RecordingEventsSheet(events: events, serverURL: server) }
        // Handoff: the same recording on the Mac or another device (its web address).
        .userActivity(RecordingHandoff.activityType) { activity in
            activity.title = model.title
            activity.webpageURL = RecordingHandoff.webpageURL(server: server, recordingID: recordingID)
            activity.isEligibleForHandoff = true
        }
        .task { await model.load() }
        .task {
            let found = (try? await client.events(recordingID: recordingID)) ?? []
            events = found.filter { $0.status != "dismissed" }
        }
    }

    @ViewBuilder
    private var documentPane: some View {
        if let document = model.document {
            DocumentView(document: document, transcript: model.transcript, onSource: { [model] ref in model.play(source: ref) })
        } else {
            message(model.documentMessage ?? ScreenText.failed, detail: model.detail?.failureMessage)
        }
    }

    @ViewBuilder
    private var transcriptPane: some View {
        if let transcript = model.transcript {
            FollowingTranscript(transcript: transcript, player: model.player, onSeek: { [model] ms in model.play(fromMs: ms) })
        } else {
            message(model.detail.map { [.uploading, .queued, .processing].contains($0.recording.status) } == true ? ScreenText.processing : "전사가 없습니다.", detail: nil)
        }
    }

    private func message(_ text: String, detail: String?) -> some View {
        VStack(spacing: LecternTokens.Space.s8) {
            Text(verbatim: text)
                .lecternFont(.body)
                .foregroundStyle(Theme.textSecondary)
            if let detail {
                Text(verbatim: detail)
                    .lecternFont(.caption)
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .multilineTextAlignment(.center)
        .padding(LecternTokens.Space.s24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Observes the player (ten updates a second) so only the transcript redraws, not the screen.
private struct FollowingTranscript: View {
    let transcript: Transcript
    @ObservedObject var player: PlayerViewModel
    let onSeek: (Int) -> Void

    var body: some View {
        TranscriptList(transcript: transcript, positionMs: player.positionMs, onSeek: onSeek)
    }
}
