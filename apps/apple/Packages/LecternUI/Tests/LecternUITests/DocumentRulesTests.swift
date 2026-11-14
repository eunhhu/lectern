import LecternKit
import XCTest
@testable import LecternUI

final class DocumentRulesTests: XCTestCase {
    private let resolver = SourceResolver(transcript: PreviewData.transcript)

    func testSourceChipLabel() {
        let time = SourceChipContent.make(.transcript(startIdx: 4, endIdx: 4), resolver: resolver)  // starts at 725,000 ms
        XCTAssertEqual(time.text, "12:05")
        XCTAssertEqual(time.accessibilityLabel, "출처, 12분 5초부터 듣기")
        XCTAssertTrue(time.isButton)
        let page = SourceChipContent.make(.pdfPage(assetID: "ast_pdf", page: 3), resolver: resolver)
        XCTAssertEqual(page.text, "p.3")
        XCTAssertEqual(page.accessibilityLabel, "출처, PDF 3쪽")
        XCTAssertTrue(page.isButton)
    }

    func testUnresolvedAndMissingSources() {
        let gone = SourceChipContent.make(.transcript(startIdx: 40, endIdx: 41), resolver: resolver)
        XCTAssertEqual(gone.text, "원본 없음")
        XCTAssertFalse(gone.isButton)
        let noTranscript = SourceChipContent.make(.transcript(startIdx: 0, endIdx: 1), resolver: SourceResolver(transcript: nil))
        XCTAssertFalse(noTranscript.isButton)
        XCTAssertEqual(SourceChipContent.missing.text, "출처 확인 필요")
    }

    func testResolverFindsSegmentsByIdxNotPosition() {
        // idx is not the array position: segments 0, 2, 7.
        let transcript = Transcript(recordingID: "r", segments: [
            .init(idx: 0, startMs: 0, endMs: 1000, speakerID: "a", text: "x"),
            .init(idx: 2, startMs: 1000, endMs: 2000, speakerID: "b", text: "y"),
            .init(idx: 7, startMs: 5000, endMs: 6000, speakerID: nil, text: "z"),
        ], speakers: [Speaker(id: "b", label: "S2", displayName: "질문자")], gaps: [])
        let r = SourceResolver(transcript: transcript)
        XCTAssertEqual(r.range(startIdx: 2, endIdx: 7), SourceResolver.Range(first: 1, last: 2, startMs: 1000, endMs: 6000))
        XCTAssertNil(r.range(startIdx: 1, endIdx: 2))
        XCTAssertNil(r.range(startIdx: 7, endIdx: 2))
        XCTAssertEqual(r.range(startIdx: 2, endIdx: 2).flatMap(r.speakerName(of:)), "질문자")
        XCTAssertNil(r.range(startIdx: 7, endIdx: 7).flatMap(r.speakerName(of:)))
    }

    func testTimeFormatting() {
        XCTAssertEqual(TimeText.timestamp(59_000), "0:59")
        XCTAssertEqual(TimeText.timestamp(3_725_000), "1:02:05")
        XCTAssertEqual(TimeText.timestamp(725_999), "12:05")
        XCTAssertEqual(TimeText.timestamp(-1), "0:00")
        XCTAssertEqual(TimeText.spoken(59_000), "59초")
        XCTAssertEqual(TimeText.spoken(725_000), "12분 5초")
        XCTAssertEqual(TimeText.spoken(3_600_000), "1시간")
        XCTAssertEqual(TimeText.spoken(0), "0초")
    }

    func testUnknownBlockRendersNothing() {
        XCTAssertEqual(renderableBlocks([.unknown(type: "timeline")]), [])
        let mixed = renderableBlocks(PreviewData.blocks)
        XCTAssertEqual(mixed.count, PreviewData.blocks.count - 1)
        XCTAssertFalse(mixed.contains { if case .unknown = $0 { true } else { false } })
    }

    func testCalloutHasTextLabel() {
        XCTAssertEqual(CalloutStyle.label(for: "exam"), "시험")
        XCTAssertEqual(CalloutStyle.label(for: "assignment"), "과제")
        XCTAssertEqual(CalloutStyle.label(for: "important"), "중요")
        XCTAssertEqual(CalloutStyle.label(for: "note"), "참고")
        XCTAssertEqual(CalloutStyle.label(for: "brand_new_tone"), "참고")
        XCTAssertEqual(CalloutStyle.toneName(for: "exam"), .danger)
        XCTAssertEqual(CalloutStyle.toneName(for: "brand_new_tone"), .info)
    }

    func testGapText() {
        XCTAssertEqual(GapText.text(kind: "break", startMs: 24_000, endMs: 725_000), "쉬는 시간 (0:24–12:05)")
        XCTAssertEqual(GapText.text(kind: "missing_transcript", startMs: 0, endMs: 60_000), "전사하지 못한 구간 (0:00–1:00)")
        XCTAssertEqual(GapText.text(kind: "other", startMs: 0, endMs: 1000), "전사가 비어 있는 구간입니다 (0:00–0:01)")
    }

    func testLegacyMarkdownIsInlineOnly() {
        let text = legacyMarkdown("## 요약\n\n**굵게** 그리고 2*3*4")
        let plain = String(text.characters)
        XCTAssertTrue(plain.hasPrefix("## 요약\n"))  // block syntax is kept as written
        XCTAssertTrue(plain.contains("굵게 그리고"))
        let bold = text.runs.contains { run in
            run.inlinePresentationIntent?.contains(.stronglyEmphasized) == true && String(text[run.range].characters) == "굵게"
        }
        XCTAssertTrue(bold)
    }
}
