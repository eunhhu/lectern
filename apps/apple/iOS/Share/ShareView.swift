import LecternKit
import SwiftUI
import UniformTypeIdentifiers

/// "공유 → Lectern": what will be added (recordings, PDFs paired with them, PDFs left out, files
/// ignored), then `Lectern에 추가` or `취소`.
struct ShareView: View {
    @ObservedObject var model: ShareModel

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                switch model.phase {
                case .signedOut:
                    Text(verbatim: ShareModel.signedOutText)
                    Spacer()
                    Button("닫기") { model.close() }
                        .buttonStyle(.borderedProminent)
                        .frame(maxWidth: .infinity)
                case .loading:
                    ProgressView("파일을 읽는 중")
                        .frame(maxWidth: .infinity)
                    Spacer()
                case let .ready(summary, unreadable):
                    ForEach(ShareModel.lines(for: summary, unreadable: unreadable), id: \.self) { line in
                        Text(verbatim: line)
                    }
                    Spacer()
                    HStack {
                        Button("취소", role: .cancel) { model.close() }
                            .buttonStyle(.bordered)
                            .frame(maxWidth: .infinity)
                        Button("Lectern에 추가") { Task { await model.add() } }
                            .buttonStyle(.borderedProminent)
                            .frame(maxWidth: .infinity)
                            .disabled(summary.recordings == 0)
                    }
                case .adding:
                    ProgressView("추가하는 중")
                        .frame(maxWidth: .infinity)
                    Spacer()
                case .added:
                    Label(ShareModel.addedText, systemImage: "checkmark.circle.fill")
                    Spacer()
                case let .failed(message):
                    Text(verbatim: message)
                        .foregroundStyle(.red)
                    Spacer()
                    Button("닫기") { model.close() }
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .navigationTitle("Lectern")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

@MainActor
final class ShareModel: ObservableObject {
    enum Phase: Equatable {
        case signedOut, loading
        /// `unreadable`: shared files the system did not hand over.
        case ready(ImportSummary, unreadable: Int)
        case adding, added
        case failed(String)
    }

    static let signedOutText = "Lectern 앱을 열어 로그인한 뒤 다시 시도해 주세요."
    static let addedText = "추가했습니다. Lectern 앱에서 업로드가 이어집니다."
    static let readFailedText = "공유한 파일을 읽지 못했습니다."

    @Published private(set) var phase: Phase = .loading

    private let inputItems: [NSExtensionItem]
    private let finish: () -> Void
    private let cancel: () -> Void
    /// When the share began: file dates at or after it belong to the copies, not the recording.
    private let startedAt = Date()
    private let container = AppEnvironment.sharedContainerURL()
    /// The shared files, copied here while each provider's temporary file still exists.
    private let staging: URL
    private var items: [SharedInbox.Item] = []
    private let workspaceID: String?

    init(inputItems: [NSExtensionItem], finish: @escaping () -> Void, cancel: @escaping () -> Void) {
        self.inputItems = inputItems
        self.finish = finish
        self.cancel = cancel
        staging = container.appendingPathComponent(SharedInbox.stagingFolder, isDirectory: true).appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
        let id = UserDefaults(suiteName: AppEnvironment.appGroup)?.string(forKey: AppEnvironment.defaultWorkspaceIDKey)
        workspaceID = (id?.isEmpty ?? true) ? nil : id
    }

    private var inbox: SharedInbox {
        SharedInbox(containerURL: container, store: .inContainer(container))
    }

    /// `녹음 2개`, `PDF 1개를 녹음에 붙입니다`, …
    static func lines(for summary: ImportSummary, unreadable: Int) -> [String] {
        var lines = [summary.recordings > 0 ? "녹음 \(summary.recordings)개" : "올릴 녹음이 없습니다."]
        if summary.pdfsPaired > 0 { lines.append("PDF \(summary.pdfsPaired)개를 녹음에 붙입니다") }
        if summary.pdfsUnpaired > 0 { lines.append("PDF \(summary.pdfsUnpaired)개는 올리지 않습니다(함께 보낸 녹음이 없습니다)") }
        if !summary.ignored.isEmpty { lines.append("추가하지 않는 파일: \(summary.ignored.joined(separator: ", "))") }
        if unreadable > 0 { lines.append("파일 \(unreadable)개를 읽지 못했습니다") }
        return lines
    }

    func load() async {
        guard workspaceID != nil else {
            phase = .signedOut
            return
        }
        let providers = inputItems.flatMap { $0.attachments ?? [] }
        var loaded: [SharedInbox.Item] = []
        for (index, provider) in providers.enumerated() {
            if let item = await stage(provider, index: index) { loaded.append(item) }
        }
        items = loaded
        guard !loaded.isEmpty else {
            phase = .failed(Self.readFailedText)
            return
        }
        phase = .ready(inbox.preview(loaded, timeZone: .current, now: startedAt), unreadable: providers.count - loaded.count)
    }

    func add() async {
        guard let workspaceID else { return }
        phase = .adding
        do {
            _ = try await inbox.importItems(items, workspaceID: workspaceID, folderID: nil, timeZone: .current, now: startedAt)
            removeStaging()
            phase = .added
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            finish()
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func close() {
        removeStaging()
        if phase == .added { finish() } else { cancel() }
    }

    private func removeStaging() {
        try? FileManager.default.removeItem(at: staging)
    }

    /// Copies the provider's file into the staging folder inside the completion handler (the
    /// temporary file is gone once it returns). Same volume: the copy is a clone, not a second
    /// file's worth of space.
    private func stage(_ provider: NSItemProvider, index: Int) async -> SharedInbox.Item? {
        let types = provider.registeredContentTypes
        guard let type = types.first(where: { $0.conforms(to: .audio) || $0.conforms(to: .pdf) }) ?? types.first(where: { $0.conforms(to: .data) }) else {
            return nil
        }
        let folder = staging.appendingPathComponent(String(index), isDirectory: true)
        let suggested = provider.suggestedName
        return await withCheckedContinuation { continuation in
            _ = provider.loadFileRepresentation(for: type, openInPlace: false) { url, _, _ in
                guard let url else { return continuation.resume(returning: nil) }
                var name = url.lastPathComponent
                if name.isEmpty, let suggested {
                    name = suggested + (type.preferredFilenameExtension.map { ".\($0)" } ?? "")
                }
                do {
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    let staged = folder.appendingPathComponent(SharedInbox.sanitize(name))
                    try FileManager.default.copyItem(at: url, to: staged)
                    continuation.resume(returning: SharedInbox.Item(url: staged, name: name))
                } catch {
                    continuation.resume(returning: nil)
                }
            }
        }
    }
}
