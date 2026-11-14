import AppKit
import LecternKit
import LecternUI
import SwiftUI

/// The main window: sign-in, or workspaces and folders | recordings | the open recording. The
/// view models and wording are the iOS app's (P6-A6).
struct MainWindow: View {
    @EnvironmentObject private var services: MacServices

    var body: some View {
        Group {
            switch services.session {
            case .starting:
                ProgressView()
                    .accessibilityLabel("불러오는 중")
            case .signedOut:
                LoginView()
            case .signedIn:
                LibraryWindow()
            }
        }
        .frame(minWidth: 860, minHeight: 540)
        .background(Theme.canvas)
        .background(WindowReader { if let window = $0 { MainWindowOpener.window = window } })
    }
}

private struct LibraryWindow: View {
    @EnvironmentObject private var services: MacServices

    var body: some View {
        LibraryColumns(model: makeModel())
            .id(ObjectIdentifier(services.client as AnyObject))
    }

    private func makeModel() -> LibraryViewModel {
        let model = LibraryViewModel(client: services.client)
        model.onUnauthorized = { [weak services] in services?.sessionExpired() }
        return model
    }
}

private struct LibraryColumns: View {
    @EnvironmentObject private var services: MacServices
    @StateObject var model: LibraryViewModel
    @State private var selectedRecording: String?
    @State private var showUploads = false

    var body: some View {
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(min: 180, ideal: 220)
        } content: {
            recordingList
                .navigationSplitViewColumnWidth(min: 260, ideal: 320)
        } detail: {
            if let selectedRecording {
                RecordingDetail(recordingID: selectedRecording, services: services)
                    .id(selectedRecording)
            } else {
                Text("녹음을 고르세요")
                    .lecternFont(.body)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .task { await model.load() }
        .onAppear(perform: openPending)
        .onChange(of: services.pendingRecordingID) { _, _ in openPending() }
        .sheet(isPresented: $showUploads) { UploadList() }
        .focusedSceneValue(\.libraryCommands, LibraryCommands(refresh: { [model] in Task { await model.refresh() } }))
        .toolbar {
            ToolbarItem {
                Button { Task { await model.refresh() } } label: { Label("새로 고침", systemImage: "arrow.clockwise") }
                    .help("새로 고침 (⌘R)")
            }
            ToolbarItem {
                Button { showUploads = true } label: { Label("업로드", systemImage: "arrow.up.circle") }
                    .help("업로드 대기열")
            }
        }
    }

    /// A notification asked for this recording: it opens whichever folder is on screen.
    private func openPending() {
        guard let id = services.pendingRecordingID else { return }
        selectedRecording = id
        services.pendingRecordingID = nil
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
                        .buttonStyle(.plain)
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
        .listStyle(.sidebar)
    }

    private func folderRow(id: String?, name: String, icon: String) -> some View {
        Button {
            Task { await model.selectFolder(id) }
        } label: {
            Label(name, systemImage: icon)
                .foregroundStyle(Theme.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
                .buttonStyle(.plain)
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
        .navigationTitle(model.folders.first { $0.id == model.folderID }?.name ?? "전체")
    }

    /// "업로드 중 1개" while anything is not uploaded yet.
    private var uploadSummary: String? {
        let pending = services.uploads.filter { !$0.state.isDone }.count
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
    }
}

// MARK: - The open recording

/// Not observing the services (a new upload state would redraw it); the window is rebuilt when
/// the client changes.
private struct RecordingDetail: View {
    let recordingID: String
    let services: MacServices

    var body: some View {
        RecordingContent(model: makeModel())
    }

    private func makeModel() -> RecordingViewModel {
        let model = RecordingViewModel(recordingID: recordingID, client: services.client)
        model.onUnauthorized = { [weak services] in services?.sessionExpired() }
        return model
    }
}

/// The document and the transcript side by side; tabs when the window is narrow. The player is
/// at the bottom, and Space plays or pauses it when no text field has the keyboard.
private struct RecordingContent: View {
    @StateObject var model: RecordingViewModel
    @State private var spaceKey = SpaceKeyMonitor()

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
                    if geometry.size.width >= 760 {
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
                        .labelsHidden()
                        .padding(.horizontal, LecternTokens.Space.s16)
                        .padding(.vertical, LecternTokens.Space.s8)
                        if model.tab == .document { documentPane } else { transcriptPane }
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if hasAudio {
                PlayerBar(model: model.player)
            }
        }
        .navigationTitle(model.title)
        .background(WindowReader { spaceKey.window = $0 })
        .onAppear(perform: startSpaceKey)
        .onDisappear { spaceKey.stop() }
        .focusedSceneValue(\.recordingCommands, RecordingCommands(
            reload: { [model] in Task { await model.load() } },
            showDocument: { [model] in model.tab = .document },
            showTranscript: { [model] in model.tab = .transcript },
            togglePlayback: { [model] in model.player.toggle() },
            hasAudio: hasAudio
        ))
        .task { await model.load() }
    }

    private var hasAudio: Bool { model.detail?.audioAssetID != nil }

    /// Weakly: if the window closes without `onDisappear`, the monitor must not keep the player.
    private func startSpaceKey() {
        let model = model
        spaceKey.start { [weak model] in
            if let model, model.detail?.audioAssetID != nil { model.player.toggle() }
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

/// Observes the player (ten updates a second) so only the transcript redraws, not the window.
private struct FollowingTranscript: View {
    let transcript: Transcript
    @ObservedObject var player: PlayerViewModel
    let onSeek: (Int) -> Void

    var body: some View {
        TranscriptList(transcript: transcript, positionMs: player.positionMs, onSeek: onSeek)
    }
}

// MARK: - Uploads

/// The upload queue: each entry's state, retry for failed ones, delete.
private struct UploadList: View {
    @EnvironmentObject private var services: MacServices
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            List {
                if services.uploads.isEmpty {
                    Text("올릴 녹음이 없습니다.")
                        .lecternFont(.body)
                        .foregroundStyle(Theme.textSecondary)
                }
                ForEach(services.uploads) { job in
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: LecternTokens.Space.s4) {
                            Text(verbatim: job.title ?? job.fileName)
                                .lecternFont(.title)
                            Text(verbatim: ScreenText.uploadState(job.state))
                                .lecternFont(.caption)
                                .foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        if case .failed = job.state {
                            Button("다시 시도") { services.retryUpload(job.id) }
                        }
                        Button("삭제", role: .destructive) { services.removeUpload(job.id) }
                    }
                    .padding(.vertical, LecternTokens.Space.s4)
                }
            }
            HStack {
                Spacer()
                Button("닫기") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(LecternTokens.Space.s16)
        }
        .frame(minWidth: 460, minHeight: 320)
    }
}

// MARK: - Commands

struct LibraryCommands {
    var refresh: () -> Void
}

struct RecordingCommands {
    var reload: () -> Void
    var showDocument: () -> Void
    var showTranscript: () -> Void
    var togglePlayback: () -> Void
    var hasAudio: Bool
}

extension FocusedValues {
    @Entry var libraryCommands: LibraryCommands?
    @Entry var recordingCommands: RecordingCommands?
}

/// The menu bar's View and 재생 menus: ⌘R, ⌘1, ⌘2 and play/pause, for the main window in front.
struct LecternCommands: Commands {
    @FocusedValue(\.libraryCommands) private var library
    @FocusedValue(\.recordingCommands) private var recording

    var body: some Commands {
        // One main window: "Lectern 열기" brings it forward instead.
        CommandGroup(replacing: .newItem) {}
        CommandGroup(before: .toolbar) {
            Button("새로 고침") {
                library?.refresh()
                recording?.reload()
            }
            .keyboardShortcut("r", modifiers: .command)
            .disabled(library == nil)
            Button("문서") { recording?.showDocument() }
                .keyboardShortcut("1", modifiers: .command)
                .disabled(recording == nil)
            Button("전사") { recording?.showTranscript() }
                .keyboardShortcut("2", modifiers: .command)
                .disabled(recording == nil)
            Divider()
        }
        CommandMenu("재생") {
            // Space plays and pauses too (not as a menu key: it would take spaces from text fields).
            Button("재생·일시정지") { recording?.togglePlayback() }
                .disabled(recording?.hasAudio != true)
        }
    }
}

// MARK: - Space to play

/// Space plays or pauses in the main window while no text field or text view has the keyboard.
@MainActor
final class SpaceKeyMonitor {
    weak var window: NSWindow?
    private var monitor: Any?

    func start(_ action: @escaping @MainActor () -> Void) {
        stop()
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .numericPad, .function])
            guard event.keyCode == 49, modifiers.isEmpty, !event.isARepeat else { return event }
            let eventWindow = event.window.map(ObjectIdentifier.init)
            // Local monitors run on the main thread.
            let handled = MainActor.assumeIsolated { () -> Bool in
                guard let window = self?.window, eventWindow == ObjectIdentifier(window),
                      !(window.firstResponder is NSText) else { return false }
                action()
                return true
            }
            return handled ? nil : event
        }
    }

    func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }
}

/// Reports the window a view is in.
private struct WindowReader: NSViewRepresentable {
    let onWindow: (NSWindow?) -> Void

    func makeNSView(context: Context) -> WindowReaderView {
        let view = WindowReaderView()
        view.onWindow = onWindow
        return view
    }

    func updateNSView(_ view: WindowReaderView, context: Context) {
        view.onWindow = onWindow
    }
}

private final class WindowReaderView: NSView {
    var onWindow: ((NSWindow?) -> Void)?

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        onWindow?(window)
    }
}
