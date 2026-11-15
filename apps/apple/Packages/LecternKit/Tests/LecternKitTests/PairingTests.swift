import Foundation
@testable import LecternKit
import XCTest

/// apps/web/test/pairing.test.ts, test for test (18 tests there: `git grep -c "test(\|it("` counts
/// 19 because a `name.split(".")` line matches `it(`), same inputs and expectations, plus the
/// NFD case of P6-A8 §6.
final class PairingTests: XCTestCase {
    private let t = Date(timeIntervalSince1970: 1_792_386_000)  // 2026-10-19 14:00 KST
    private let hour: TimeInterval = 3600

    private func file(_ name: String, size: Int64 = 1024, type: String? = nil, lastModified: Date? = nil) -> PairFile {
        let ext = name.split(separator: ".").last.map(String.init)
        let guessed = ext == "pdf" ? "application/pdf" : ext == "m4a" ? "audio/mp4" : ext == "mp3" ? "audio/mpeg" : ""
        return PairFile(name: name, type: type ?? guessed, lastModified: lastModified ?? t, size: size, id: name)
    }

    private func names(_ files: [PairFile]) -> [String] { files.map(\.name) }

    // MARK: - classifyFile

    func testRecognisesAudioByExtensionOrMimeAndPdfs() {
        XCTAssertEqual(classifyFile(name: "a.m4a", type: "audio/mp4"), .audio)
        XCTAssertEqual(classifyFile(name: "voice.WAV", type: ""), .audio)
        XCTAssertEqual(classifyFile(name: "clip.oga", type: "audio/ogg"), .audio)
        XCTAssertEqual(classifyFile(name: "slides.pdf", type: "application/pdf"), .pdf)
        XCTAssertNil(classifyFile(name: "notes.docx", type: "application/vnd.openxmlformats"))
        XCTAssertNil(classifyFile(name: "photo.png", type: "image/png"))
    }

    // MARK: - parseFileName

    func testExtractsDatesTimesNumbersAndWordsDroppingFiller() {
        let p = parseFileName("Recording_20261019_143005.m4a")
        XCTAssertEqual(p.dayKey, "10-19")
        XCTAssertEqual(p.local, LocalDateTime(year: 2026, month: 10, day: 19, hour: 14, minute: 30))
        XCTAssertEqual(p.words, [])
        XCTAssertEqual(p.title, "")

        let q = parseFileName("운영체제_7주차_스케줄링_강의자료.pdf")
        XCTAssertEqual(q.words, ["운영체제", "주차", "스케줄링"])
        XCTAssertEqual(q.numbers, ["7"])
        XCTAssertNil(q.dayKey)
    }

    func testNormalisesMacOSNfdNamesToNfc() {
        let nfd = "운영체제 7주차.m4a".decomposedStringWithCanonicalMapping
        XCTAssertEqual(parseFileName(nfd).words, ["운영체제", "주차"])
        XCTAssertEqual(parseFileName(nfd).title, "운영체제 7주차")
    }

    func testReadsKoreanMonthDayDatesAndExplicitPartMarkersOnly() {
        XCTAssertEqual(parseFileName("자료구조 10월 9일.pdf").dayKey, "10-09")
        XCTAssertEqual(parseFileName("자료구조 강의 2부.m4a").part, 2)
        XCTAssertEqual(parseFileName("lecture_part1.mp3").part, 1)
        // A bare trailing number or a macOS duplicate suffix is not a part.
        XCTAssertNil(parseFileName("운영체제 7.m4a").part)
        XCTAssertNil(parseFileName("새로운 녹음 (1).m4a").part)
        // "부" inside a word is not a part marker.
        XCTAssertNil(parseFileName("3부서 회의.m4a").part)
    }

    // MARK: - pairFiles

    func testPairsBySharedWordsAndNumbers() {
        let r = pairFiles([
            file("운영체제 7주차.m4a"),
            file("자료구조 5주차.m4a"),
            file("운영체제_7주차_스케줄링.pdf"),
            file("자료구조_05_힙.pdf"),
        ])
        XCTAssertEqual(r.groups.map { names($0.audio) }, [["운영체제 7주차.m4a"], ["자료구조 5주차.m4a"]])
        XCTAssertEqual(r.groups.map { names($0.pdfs.map(\.file)) }, [["운영체제_7주차_스케줄링.pdf"], ["자료구조_05_힙.pdf"]])
        XCTAssertTrue(Set(r.groups[0].pdfs[0].reasons).isSuperset(of: [.name, .number]))
        XCTAssertEqual(r.unmatched, [])
    }

    func testDifferentNumbersNeverPairEvenWithIdenticalWords() {
        let r = pairFiles([file("운영체제 6주차.m4a"), file("운영체제 8주차.m4a"), file("운영체제 7주차.pdf")])
        XCTAssertTrue(r.groups.allSatisfy { $0.pdfs.isEmpty })
        XCTAssertEqual(names(r.unmatched), ["운영체제 7주차.pdf"])
    }

    func testPairsDeviceNamedRecordingsWithPdfsByDate() {
        let r = pairFiles([
            file("Recording_20261019_143005.m4a", lastModified: t + 5 * hour),
            file("Recording_20261017_100000.m4a", lastModified: t + 5 * hour),
            file("강의자료_2026-10-19.pdf", lastModified: t - 20 * hour),
        ])
        XCTAssertEqual(names(r.groups[0].pdfs.map(\.file)), ["강의자료_2026-10-19.pdf"])
        XCTAssertTrue(r.groups[0].pdfs[0].reasons.contains(.date))
        XCTAssertEqual(r.groups[1].pdfs, [])
    }

    func testConflictingDatesNeverPair() {
        let r = pairFiles([
            file("세미나_20261019.m4a"),
            file("세미나 자료_20261012.pdf"),
            file("회의.m4a", lastModified: t + 30 * hour),
        ])
        XCTAssertEqual(names(r.unmatched), ["세미나 자료_20261012.pdf"])
    }

    func testFallsBackToModificationTimeWhenTheNamesSayNothing() {
        let r = pairFiles([
            file("새로운 녹음 23.m4a", lastModified: t),
            file("새로운 녹음 24.m4a", lastModified: t + 6 * hour),
            file("handout.pdf", lastModified: t + 6 * hour - 10 * 60),
        ])
        // "23" vs no number in the PDF: no conflict, so the 10-minute gap decides.
        XCTAssertEqual(names(r.groups[1].pdfs.map(\.file)), ["handout.pdf"])
        XCTAssertEqual(r.groups[1].pdfs[0].reasons, [.time])
        // An hour apart is not enough on its own.
        let far = pairFiles([file("a.m4a"), file("b.m4a", lastModified: t + 9 * hour), file("c.pdf", lastModified: t + hour)])
        XCTAssertEqual(names(far.unmatched), ["c.pdf"])
    }

    func testTimeAloneDoesNotChooseBetweenRecordingsThatAreAboutAsClose() {
        let r = pairFiles([
            file("새로운 녹음 23.m4a", lastModified: t),
            file("새로운 녹음 24.m4a", lastModified: t + 60),
            file("handout.pdf", lastModified: t + 30),
        ])
        XCTAssertEqual(names(r.unmatched), ["handout.pdf"])
    }

    func testADropWithOneRecordingTakesEveryPdf() {
        let r = pairFiles([file("녹음.m4a"), file("slides.pdf", lastModified: t - 48 * hour), file("reading.pdf")])
        XCTAssertEqual(r.groups.count, 1)
        XCTAssertEqual(names(r.groups[0].pdfs.map(\.file)).sorted(), ["reading.pdf", "slides.pdf"])
        XCTAssertEqual(r.groups[0].pdfs.first { $0.file.name == "slides.pdf" }?.reasons, [.onlyRecording])
        XCTAssertEqual(r.unmatched, [])
    }

    func testOneRecordingCanTakeSeveralMatchingPdfs() {
        let r = pairFiles([
            file("미시경제학 4주차.m4a"),
            file("운영체제 7주차.m4a"),
            file("미시경제학 4주차 슬라이드.pdf"),
            file("미시경제학 4주차 연습문제.pdf"),
        ])
        XCTAssertEqual(r.groups[0].pdfs.count, 2)
        XCTAssertEqual(r.groups[1].pdfs.count, 0)
    }

    func testExplicitPartsBecomeOneRecordingOrderedByPartNumber() {
        let r = pairFiles([file("자료구조 5주차 2부.m4a"), file("자료구조 5주차 1부.m4a"), file("자료구조 5주차.pdf")])
        XCTAssertEqual(r.groups.count, 1)
        XCTAssertEqual(names(r.groups[0].audio), ["자료구조 5주차 1부.m4a", "자료구조 5주차 2부.m4a"])
        XCTAssertEqual(r.groups[0].title, "자료구조 5주차")
        XCTAssertEqual(r.groups[0].pdfs.count, 1)
    }

    func testDuplicatePartNumbersStaySeparateRecordings() {
        let r = pairFiles([file("세미나 1부.m4a"), file("세미나 1부.mp3")])
        XCTAssertEqual(r.groups.count, 2)
    }

    func testTitlesComeFromTheNameTheStartTimeFromADatedNameInLocalTime() {
        let r = pairFiles([file("운영체제_7주차.m4a"), file("Recording_20261019_143005.m4a")])
        XCTAssertEqual(r.groups[0].title, "운영체제 7주차")
        XCTAssertNil(r.groups[0].recordedAt)
        XCTAssertNil(r.groups[1].title)
        XCTAssertEqual(r.groups[1].recordedAt, ISO8601DateFormatter().date(from: "2026-10-19T05:30:00Z"))  // 14:30 KST
    }

    func testRejectsUnsupportedAndEmptyFilesAndPdfsAloneFormNoRecording() {
        let r = pairFiles([file("notes.docx"), file("empty.m4a", size: 0), file("slides.pdf")])
        XCTAssertEqual(r.rejected.map { [$0.file.name, $0.reason.rawValue] }, [["notes.docx", "unsupported"], ["empty.m4a", "empty"]])
        XCTAssertEqual(r.groups, [])
        XCTAssertEqual(names(r.unmatched), ["slides.pdf"])
    }

    func testIsDeterministicAndKeepsTheDropOrder() {
        let files = [file("b 1주차.m4a"), file("a 2주차.m4a"), file("a 2주차.pdf"), file("b 1주차.pdf")]
        XCTAssertEqual(pairFiles(files), pairFiles(files))
        XCTAssertEqual(pairFiles(files).groups.map { $0.audio[0].name }, ["b 1주차.m4a", "a 2주차.m4a"])
    }

    // MARK: - assignPdf

    func testMovesAPdfBetweenGroupsAndOutOfThem() {
        let pdf = file("handout.pdf")
        let r = pairFiles([file("a 1주차.m4a"), file("b 2주차.m4a"), pdf])
        let toB = assignPdf(r, fileID: pdf.id, groupID: r.groups[1].id)
        XCTAssertEqual(toB.groups[1].pdfs.map(\.file), [pdf])
        XCTAssertEqual(toB.unmatched, [])
        let out = assignPdf(toB, fileID: pdf.id, groupID: nil)
        XCTAssertTrue(out.groups.allSatisfy { $0.pdfs.isEmpty })
        XCTAssertEqual(out.unmatched, [pdf])
    }

    // MARK: - P6-A8

    func testNfdFileNamesPairLikeNfc() {
        let r = pairFiles([
            file("운영체제 7주차.m4a".decomposedStringWithCanonicalMapping),
            file("자료구조 5주차.m4a"),
            file("운영체제 7주차 스케줄링.pdf"),
        ])
        XCTAssertEqual(r.groups[0].pdfs.map(\.file.name), ["운영체제 7주차 스케줄링.pdf"])
        XCTAssertEqual(r.unmatched, [])
    }
}
