import Foundation
import LecternKit

/// Workspaces, folders and the recording list (paged). A 401 calls `onUnauthorized`.
@MainActor
public final class LibraryViewModel: ObservableObject {
    @Published public private(set) var workspaces: [WorkspaceSummary] = []
    @Published public private(set) var workspaceID: String?
    @Published public private(set) var folders: [Folder] = []
    /// nil: every recording in the workspace ("전체").
    @Published public private(set) var folderID: String?
    @Published public private(set) var recordings: [RecordingSummary] = []
    @Published public private(set) var phase: Phase = .loading
    @Published public private(set) var isLoadingMore = false

    public var onUnauthorized: (@MainActor () -> Void)?
    /// A list arrived (first page or more): Spotlight and, for the whole workspace
    /// (`folderID` nil), the widgets take it.
    public var onListLoaded: (@MainActor (_ workspaceID: String, _ folderID: String?, _ recordings: [RecordingSummary], _ folders: [Folder]) -> Void)?

    private let client: LecternClient
    private var nextCursor: String?
    /// Cursors already asked for in this list, so the end of the list loads each page once.
    private var requested: Set<String> = []
    /// Bumped on every new list (folder, workspace, refresh): older answers are dropped.
    private var generation = 0

    public init(client: LecternClient) {
        self.client = client
    }

    public func load() async {
        phase = .loading
        do {
            let all = try await client.workspaces()
            workspaces = all
            let me = try? await client.me()
            workspaceID = workspaceID.flatMap { id in all.first { $0.id == id }?.id }
                ?? all.first { $0.id == me?.personalWorkspaceID }?.id
                ?? all.first?.id
            guard let workspaceID else {
                recordings = []
                phase = .empty
                return
            }
            folders = try await client.folders(workspaceID: workspaceID)
            await reloadList()
        } catch {
            fail(error)
        }
    }

    /// Pull to refresh: the first page again.
    public func refresh() async {
        guard workspaceID != nil else { return await load() }
        await reloadList()
    }

    public func selectWorkspace(_ id: String) async {
        guard id != workspaceID else { return }
        workspaceID = id
        folderID = nil
        folders = []
        do {
            folders = try await client.folders(workspaceID: id)
        } catch {
            return fail(error)
        }
        await reloadList()
    }

    public func selectFolder(_ id: String?) async {
        guard id != folderID else { return }
        folderID = id
        await reloadList()
    }

    /// Called as rows appear: the last row loads the next page (once).
    public func loadMore(after recording: RecordingSummary) async {
        guard recording.id == recordings.last?.id, let cursor = nextCursor, !requested.contains(cursor),
              let workspaceID else { return }
        requested.insert(cursor)
        isLoadingMore = true
        defer { isLoadingMore = false }
        let started = generation
        do {
            let page = try await client.recordings(workspaceID: workspaceID, folderID: folderID, cursor: cursor)
            guard started == generation else { return }
            let known = Set(recordings.map(\.id))
            recordings += page.items.filter { !known.contains($0.id) }
            nextCursor = page.nextCursor
            onListLoaded?(workspaceID, folderID, recordings, folders)
        } catch {
            requested.remove(cursor)
            if case APIError.unauthorized = error { onUnauthorized?() }
        }
    }

    private func reloadList() async {
        guard let workspaceID else { return }
        generation += 1
        let started = generation
        requested = []
        if recordings.isEmpty { phase = .loading }
        do {
            let page = try await client.recordings(workspaceID: workspaceID, folderID: folderID, cursor: nil)
            guard started == generation else { return }
            recordings = page.items
            nextCursor = page.nextCursor
            phase = page.items.isEmpty ? .empty : .loaded
            onListLoaded?(workspaceID, folderID, recordings, folders)
        } catch {
            guard started == generation else { return }
            fail(error)
        }
    }

    private func fail(_ error: Error) {
        guard !ScreenText.isCancellation(error) else { return }
        if case APIError.unauthorized = error {
            onUnauthorized?()
        }
        phase = .failed(ScreenText.message(for: error))
    }
}
