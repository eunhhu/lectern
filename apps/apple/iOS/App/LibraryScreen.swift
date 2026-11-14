import LecternKit
import LecternUI
import SwiftUI

/// Workspaces and folders | recordings | the open recording. Three columns on iPad, a stack on
/// iPhone (NavigationSplitView collapses by itself).
struct LibraryScreen: View {
    @EnvironmentObject private var app: AppModel

    var body: some View {
        LibraryColumns(model: makeModel())
            .id(ObjectIdentifier(app.client as AnyObject))
    }

    private func makeModel() -> LibraryViewModel {
        let model = LibraryViewModel(client: app.client)
        model.onUnauthorized = { [weak app] in app?.sessionExpired() }
        return model
    }
}

private struct LibraryColumns: View {
    @EnvironmentObject private var app: AppModel
    @StateObject var model: LibraryViewModel
    @State private var selectedRecording: String?
    @State private var showSettings = false
    @State private var showUploads = false
    /// iPhone (compact): the list of recordings first; a folder tap comes back to it.
    @State private var compactColumn = NavigationSplitViewColumn.content

    var body: some View {
        NavigationSplitView(preferredCompactColumn: $compactColumn) {
            sidebar
        } content: {
            recordingList
        } detail: {
            if let selectedRecording {
                RecordingScreen(recordingID: selectedRecording)
                    .id(selectedRecording)
            } else {
                Text("녹음을 고르세요")
                    .lecternFont(.body)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .task { await model.load() }
        .sheet(isPresented: $showSettings) { SettingsScreen() }
        .sheet(isPresented: $showUploads) { UploadQueueSheet() }
    }

    private var sidebar: some View {
        List {
            if model.workspaces.count > 1 {
                Section("워크스페이스") {
                    ForEach(model.workspaces) { workspace in
                        Button {
                            Task { await model.selectWorkspace(workspace.id) }
                        } label: {
                            Label(workspace.name, systemImage: workspace.id == model.workspaceID ? "checkmark.circle.fill" : "circle")
                        }
                        .accessibilityAddTraits(workspace.id == model.workspaceID ? .isSelected : [])
                    }
                }
            }
            Section("폴더") {
                folderRow(id: nil, name: "전체", icon: "tray.full")
                ForEach(model.folders) { folder in
                    folderRow(id: folder.id, name: folder.name, icon: "folder")
                }
            }
        }
        .navigationTitle("Lectern")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showSettings = true } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("설정")
            }
        }
    }

    private func folderRow(id: String?, name: String, icon: String) -> some View {
        Button {
            compactColumn = .content
            Task { await model.selectFolder(id) }
        } label: {
            Label(name, systemImage: icon)
                .foregroundStyle(Theme.textPrimary)
        }
        .listRowBackground(model.folderID == id ? Theme.selected : Color.clear)
        .accessibilityAddTraits(model.folderID == id ? .isSelected : [])
    }

    private var recordingList: some View {
        List(selection: $selectedRecording) {
            if let summary = uploadSummary {
                Button { showUploads = true } label: {
                    Label(summary, systemImage: "arrow.up.circle")
                        .lecternFont(.label)
                        .foregroundStyle(Theme.accentText)
                }
                .accessibilityHint("업로드 대기열을 엽니다")
            }
            switch model.phase {
            case .loading:
                ProgressView().frame(maxWidth: .infinity)
                    .accessibilityLabel("불러오는 중")
            case .empty:
                Text(verbatim: ScreenText.noRecordings)
                    .lecternFont(.body)
                    .foregroundStyle(Theme.textSecondary)
            case let .failed(message):
                VStack(alignment: .leading, spacing: LecternTokens.Space.s8) {
                    Text(verbatim: message)
                        .lecternFont(.body)
                        .foregroundStyle(Theme.tone(.danger).text)
                    Button("다시 시도") { Task { await model.load() } }
                }
            case .loaded:
                ForEach(model.recordings) { recording in
                    RecordingRow(recording: recording)
                        .tag(recording.id)
                        .task { await model.loadMore(after: recording) }
                }
                if model.isLoadingMore {
                    ProgressView().frame(maxWidth: .infinity)
                        .accessibilityLabel("더 불러오는 중")
                }
            }
        }
        .refreshable { await model.refresh() }
        .navigationTitle(model.folders.first { $0.id == model.folderID }?.name ?? "전체")
    }

    /// "업로드 중 1개" while anything is not uploaded yet.
    private var uploadSummary: String? {
        let pending = app.uploads.filter { !$0.state.isDone }.count
        return pending > 0 ? "업로드 중 \(pending)개" : nil
    }
}

private struct RecordingRow: View {
    let recording: RecordingSummary

    var body: some View {
        VStack(alignment: .leading, spacing: LecternTokens.Space.s4) {
            Text(verbatim: recording.title)
                .lecternFont(.title)
                .foregroundStyle(Theme.textPrimary)
            HStack(spacing: LecternTokens.Space.s8) {
                Text(verbatim: ScreenText.recordedAt(recording.recordedAt))
                if let duration = ScreenText.duration(recording.durationMs) {
                    Text(verbatim: duration)
                }
                if let status = ScreenText.statusLabel(recording.status) {
                    Text(verbatim: status)
                        .foregroundStyle(recording.status == .failed ? Theme.tone(.danger).text : Theme.accentText)
                }
            }
            .lecternFont(.caption)
            .foregroundStyle(Theme.textSecondary)
        }
        .padding(.vertical, LecternTokens.Space.s4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ScreenText.rowAccessibilityLabel(recording))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("recording.row")
    }
}

/// The upload queue: each entry's state, retry for failed ones, delete.
private struct UploadQueueSheet: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if app.uploads.isEmpty {
                    Text("올릴 녹음이 없습니다.")
                        .lecternFont(.body)
                        .foregroundStyle(Theme.textSecondary)
                }
                ForEach(app.uploads) { job in
                    VStack(alignment: .leading, spacing: LecternTokens.Space.s4) {
                        Text(verbatim: job.title ?? job.fileName)
                            .lecternFont(.title)
                        Text(verbatim: ScreenText.uploadState(job.state))
                            .lecternFont(.caption)
                            .foregroundStyle(Theme.textSecondary)
                        HStack {
                            if case .failed = job.state {
                                Button("다시 시도") { app.retryUpload(job.id) }
                            }
                            Button("삭제", role: .destructive) { app.removeUpload(job.id) }
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
            .navigationTitle("업로드")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("닫기") { dismiss() }
                }
            }
        }
    }
}
