import Foundation
import LecternKit
import SwiftUI

/// A made-up lecture for previews and tests: every block type, a short transcript, two
/// speakers. No real lecture or person.
public enum PreviewData {
    public static let transcript = Transcript(
        recordingID: "rec_preview",
        segments: [
            .init(idx: 0, startMs: 0, endMs: 4_000, speakerID: "spk_1", text: "오늘은 정렬 알고리즘의 시간 복잡도를 봅니다."),
            .init(idx: 1, startMs: 4_000, endMs: 9_000, speakerID: "spk_1", text: "병합 정렬은 배열을 반으로 나누고 다시 합칩니다."),
            .init(idx: 2, startMs: 9_000, endMs: 15_000, speakerID: "spk_2", text: "합치는 단계가 왜 선형 시간인가요?"),
            .init(idx: 3, startMs: 15_000, endMs: 24_000, speakerID: "spk_1", text: "두 배열의 앞에서부터 한 번씩만 비교하기 때문입니다."),
            .init(idx: 4, startMs: 725_000, endMs: 731_000, speakerID: "spk_1", text: "이 부분은 다음 주 시험에 나옵니다."),
        ],
        speakers: [
            Speaker(id: "spk_1", label: "S1", displayName: "강사"),
            Speaker(id: "spk_2", label: "S2", displayName: nil),
        ],
        gaps: [Transcript.Gap(kind: "break", startMs: 24_000, endMs: 725_000)]
    )

    private static let t01: [SourceRef] = [.transcript(startIdx: 0, endIdx: 1)]

    public static let blocks: [DocumentBlock] = [
        .paragraph(id: "b1", heading: "개요", text: "병합 정렬은 분할 정복으로 정렬하며 항상 O(n log n) 시간이 걸린다.", sources: t01),
        .list(id: "b2", heading: "단계", numbered: true, items: [
            ListItem(text: "배열을 반으로 나눈다.", sources: [.transcript(startIdx: 1, endIdx: 1)]),
            ListItem(text: "각 절반을 재귀로 정렬한다.", sources: []),
            ListItem(text: "정렬된 두 절반을 합친다.", sources: [.transcript(startIdx: 3, endIdx: 3)]),
        ], sources: []),
        .quote(id: "b3", heading: nil, text: "두 배열의 앞에서부터 한 번씩만 비교하기 때문입니다.", speaker: "S1", sources: [.transcript(startIdx: 3, endIdx: 3)]),
        .term(id: "b4", heading: nil, term: "안정 정렬", definition: "값이 같은 원소의 원래 순서를 유지하는 정렬.", sources: [.pdfPage(assetID: "ast_pdf", page: 3)]),
        .formula(id: "b5", heading: nil, expression: "T(n) = 2T(n/2) + O(n)", explanation: "나누기 두 번과 선형 합치기.", sources: t01),
        .callout(id: "b6", heading: nil, tone: "exam", text: "합치는 단계의 비교 횟수를 묻는 문제가 나온다.", sources: [.transcript(startIdx: 4, endIdx: 4)]),
        .callout(id: "b7", heading: nil, tone: "note", text: "자세한 증명은 교재 3장.", sources: [.pdfPage(assetID: "ast_pdf", page: 41)]),
        .gap(id: "b8", heading: nil, kind: "break", startMs: 24_000, endMs: 725_000),
        .unknown(type: "timeline"),
    ]

    public static let document = LecternKit.Document(
        id: "doc_preview",
        recordingID: "rec_preview",
        templateID: "lecture",
        version: 1,
        sections: [
            LecternKit.Document.Section(key: "summary", title: "요약", blocks: Array(blocks.prefix(3))),
            LecternKit.Document.Section(key: "details", title: "자세히", blocks: Array(blocks.dropFirst(3))),
        ],
        markdown: "",
        updatedAt: Date(timeIntervalSince1970: 1_792_387_800)
    )

    public static let legacyDocument = LecternKit.Document(
        id: "doc_legacy", recordingID: "rec_preview", templateID: "legacy-markdown", version: 1, sections: [],
        markdown: "## 요약\n\n병합 정렬은 **분할 정복**으로 정렬한다.\n\n- 나누기\n- 합치기",
        updatedAt: Date(timeIntervalSince1970: 1_792_387_800)
    )
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
