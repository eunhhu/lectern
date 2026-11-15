import Foundation
import LecternKit
import SwiftUI

/// The fixture lecture (LecternKit `FixtureData`) under the name the previews and tests use.
public enum PreviewData {
    public static var transcript: Transcript { FixtureData.transcript }
    public static var blocks: [DocumentBlock] { FixtureData.blocks }
    public static var document: LecternKit.Document { FixtureData.document }
    public static var legacyDocument: LecternKit.Document { FixtureData.legacyDocument }
}

/// One block in light mode, dark mode, and the largest accessibility text size.
private struct BlockPreview: View {
    let block: DocumentBlock

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LecternTokens.Space.s16) {
                variant.environment(\.colorScheme, .light)
                variant.environment(\.colorScheme, .dark)
                variant.environment(\.dynamicTypeSize, .accessibility5)
            }
            .padding()
        }
    }

    private var variant: some View {
        BlockView(block: block, resolver: SourceResolver(transcript: PreviewData.transcript), onSource: { _ in })
            .padding()
            .background(Theme.panel)
    }
}

#Preview("paragraph") { BlockPreview(block: PreviewData.blocks[0]) }
#Preview("list") { BlockPreview(block: PreviewData.blocks[1]) }
#Preview("quote") { BlockPreview(block: PreviewData.blocks[2]) }
#Preview("term") { BlockPreview(block: PreviewData.blocks[3]) }
#Preview("formula") { BlockPreview(block: PreviewData.blocks[4]) }
#Preview("callout") { BlockPreview(block: PreviewData.blocks[5]) }
#Preview("gap") { BlockPreview(block: PreviewData.blocks[7]) }
#Preview("unknown (nothing)") { BlockPreview(block: PreviewData.blocks[8]) }
#Preview("document") { DocumentView(document: PreviewData.document, transcript: PreviewData.transcript, onSource: { _ in }) }
#Preview("legacy document") { DocumentView(document: PreviewData.legacyDocument, onSource: { _ in }) }
#Preview("transcript") { TranscriptList(transcript: PreviewData.transcript, positionMs: 10_000, onSeek: { _ in }) }
#Preview("player") { PlayerBar(model: PlayerViewModel(loadItem: { throw CancellationError() })) }
