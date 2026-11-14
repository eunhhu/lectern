// Port of apps/web/src/lib/pairing.ts. Keep the two in step; PairingTests mirrors apps/web/test/pairing.test.ts.
//
// Pairs the audio files and PDFs of one share into upload groups (one group = one new recording
// = one upload session). Pure: it only looks at file names, sizes, types and modification times.
//
// Rules, strongest first:
// 1. A date in both names ("20261019", "2026-10-19", "10월 19일") must agree.
// 2. Numbers in both names ("7주차", "lecture07") must share at least one value.
// 3. Shared words (minus filler like "녹음", "slides", "강의자료") raise the score.
// 4. Close modification times add a little (within 3 hours), and alone are enough within about
//    15 minutes, as long as no other recording is about as close.
// 5. If the share has a single recording, every PDF belongs to it.
// Audio files that differ only by an explicit part marker ("1부"/"2부", "part1") become one
// recording with several audio parts.
//
// Differences from the TypeScript, none in the rules: `\d` is written `[0-9]` (JavaScript's `\d`
// is ASCII only, ICU's is any decimal digit); a file without a modification time gives no time
// evidence (a browser File always has one); names are NFC-normalised as on the web.

import Foundation

public enum PairFileKind: Sendable, Equatable {
    case audio, pdf
}

public struct PairFile: Sendable, Equatable {
    public var name: String
    public var type: String?
    public var lastModified: Date?
    public var size: Int64
    /// Identifies the file in a result (`assignPdf`).
    public var id: String

    public init(name: String, type: String?, lastModified: Date?, size: Int64, id: String) {
        self.name = name
        self.type = type
        self.lastModified = lastModified
        self.size = size
        self.id = id
    }
}

private let audioExtensions: Set<String> = ["m4a", "mp3", "wav", "aac", "ogg", "oga", "opus", "weba", "flac", "caf", "amr"]

public func extensionOf(_ name: String) -> String {
    guard let match = PairingRegex.extension_.firstMatch(in: name) else { return "" }
    return match.group(1, in: name)?.lowercased() ?? ""
}

public func classifyFile(name: String, type: String?) -> PairFileKind? {
    let ext = extensionOf(name)
    if ext == "pdf" || type == "application/pdf" { return .pdf }
    if audioExtensions.contains(ext) || ((type ?? "").hasPrefix("audio/") && !ext.isEmpty) { return .audio }
    return nil
}

public struct LocalDateTime: Sendable, Equatable {
    public var year: Int
    public var month: Int
    public var day: Int
    public var hour: Int
    public var minute: Int

    public init(year: Int, month: Int, day: Int, hour: Int, minute: Int) {
        self.year = year
        self.month = month
        self.day = day
        self.hour = hour
        self.minute = minute
    }
}

public struct ParsedName: Sendable, Equatable {
    /// File name without its extension, NFC-normalised (Apple systems hand out NFD).
    public var base: String
    public var words: [String]
    public var numbers: [String]
    /// "MM-DD" when the name contains a date.
    public var dayKey: String?
    /// Wall-clock start when the name has a full date and time ("20261019_143005").
    public var local: LocalDateTime?
    /// Explicit part number ("1부", "part2") and the readable name without it.
    public var part: Int?
    public var partStem: String
    /// Readable title with dates and separators removed; "" when only filler remains.
    public var title: String
}

private let fillerWords: Set<String> = [
    "녹음", "음성", "녹취", "파일", "새로운", "새", "recording", "record", "rec", "audio", "voice", "memo", "new",
    "자료", "강의자료", "수업자료", "슬라이드", "slides", "slide", "handout", "notes", "note", "필기", "교안",
    "ppt", "pdf", "final", "최종", "copy", "사본",
]

public func parseFileName(_ name: String) -> ParsedName {
    let base = PairingRegex.trailingExtension.replacingFirst(in: name.precomposedStringWithCanonicalMapping, with: "")
    var rest = base
    var dayKey: String?
    var local: LocalDateTime?

    if let full = PairingRegex.fullDate.firstMatch(in: rest) {
        let y = full.group(1, in: rest)!, mo = full.group(2, in: rest)!, d = full.group(3, in: rest)!
        dayKey = "\(mo)-\(d)"
        if let h = full.group(4, in: rest), let mi = full.group(5, in: rest) {
            local = LocalDateTime(year: Int(y)!, month: Int(mo)!, day: Int(d)!, hour: Int(h)!, minute: Int(mi)!)
        }
        rest = replaceFirstOccurrence(of: full.text(in: rest), in: rest, with: " ")
    } else if let ko = PairingRegex.koreanDate.firstMatch(in: rest) {
        dayKey = "\(pad2(ko.group(1, in: rest)!))-\(pad2(ko.group(2, in: rest)!))"
        rest = replaceFirstOccurrence(of: ko.text(in: rest), in: rest, with: " ")
    }

    var part: Int?
    var partless = rest
    if let match = PairingRegex.part.firstMatch(in: rest) {
        part = Int(match.group(1, in: rest) ?? match.group(2, in: rest) ?? "")
        partless = replaceFirstOccurrence(of: match.text(in: rest), in: rest, with: " ")
    }

    let tokens = tokenize(partless.lowercased())
    let numbers = unique(tokens.filter(isAllNumber).map(jsNumberString))
    let words = unique(tokens.filter { !isAllNumber($0) && !fillerWords.contains($0) })
    let partStem = tidy(partless)
    return ParsedName(base: base, words: words, numbers: numbers, dayKey: dayKey, local: local, part: part, partStem: partStem, title: words.isEmpty ? "" : tidy(rest))
}

public enum PairReason: String, Sendable, Equatable {
    case name, number, date, time
    case onlyRecording = "only_recording"
}

public struct PairedPdf: Sendable, Equatable {
    public var file: PairFile
    public var reasons: [PairReason]
}

public struct UploadGroup: Sendable, Equatable {
    /// Stable within one pairing result.
    public var id: String
    /// Audio parts in playback order (`asset.part_index`).
    public var audio: [PairFile]
    public var pdfs: [PairedPdf]
    /// Suggested title from the file name, or nil to let the server classify it.
    public var title: String?
    /// Start time when the audio file name carries one.
    public var recordedAt: Date?
}

public struct RejectedFile: Sendable, Equatable {
    public enum Reason: String, Sendable { case unsupported, empty }
    public var file: PairFile
    public var reason: Reason
}

public struct PairingResult: Sendable, Equatable {
    public var groups: [UploadGroup]
    /// PDFs that matched no recording.
    public var unmatched: [PairFile]
    public var rejected: [RejectedFile]
}

public let pairThreshold = 0.45
private let timeWindowMs = 3.0 * 3_600_000
/// A time-only match must beat every other recording by this much (≈20 minutes).
private let timeMargin = 0.05

private struct Candidate {
    var score: Double
    var reasons: [PairReason]
    var timeGap: Double
}

private struct ParsedFile {
    var file: PairFile
    var parsed: ParsedName
}

private func scorePair(_ audio: ParsedFile, _ pdf: ParsedFile) -> Candidate {
    let a = audio.parsed
    let p = pdf.parsed
    var reasons: [PairReason] = []
    let timeGap: Double
    if let am = audio.file.lastModified, let pm = pdf.file.lastModified {
        timeGap = abs(am.timeIntervalSince(pm) * 1000)
    } else {
        timeGap = .infinity
    }
    if let ad = a.dayKey, let pd = p.dayKey, ad != pd { return Candidate(score: 0, reasons: reasons, timeGap: timeGap) }
    if !a.numbers.isEmpty, !p.numbers.isEmpty, !a.numbers.contains(where: { p.numbers.contains($0) }) {
        return Candidate(score: 0, reasons: reasons, timeGap: timeGap)
    }
    var score = 0.0
    let union = Set(a.words + p.words)
    let shared = a.words.filter { p.words.contains($0) }.count
    if !union.isEmpty, shared > 0 {
        score += Double(shared) / Double(union.count)
        reasons.append(.name)
    }
    if !a.numbers.isEmpty, !p.numbers.isEmpty {
        score += 0.3
        reasons.append(.number)
    }
    if let ad = a.dayKey, ad == p.dayKey {
        score += 0.5
        reasons.append(.date)
    }
    if timeGap <= timeWindowMs {
        score += 0.5 * (1 - timeGap / timeWindowMs)
        reasons.append(.time)
    }
    return Candidate(score: score, reasons: reasons, timeGap: timeGap)
}

public func pairFiles(_ files: [PairFile], timeZone: TimeZone = TimeZone(identifier: "Asia/Seoul")!) -> PairingResult {
    var rejected: [RejectedFile] = []
    var audios: [ParsedFile] = []
    var pdfs: [ParsedFile] = []
    for file in files {
        guard let kind = classifyFile(name: file.name, type: file.type) else {
            rejected.append(RejectedFile(file: file, reason: .unsupported))
            continue
        }
        if file.size <= 0 {
            rejected.append(RejectedFile(file: file, reason: .empty))
        } else if kind == .audio {
            audios.append(ParsedFile(file: file, parsed: parseFileName(file.name)))
        } else {
            pdfs.append(ParsedFile(file: file, parsed: parseFileName(file.name)))
        }
    }

    // Multi-part recordings: same name apart from distinct explicit part numbers.
    func stemKey(_ a: ParsedFile) -> String { "\(a.parsed.partStem)\u{0}\(a.parsed.dayKey ?? "")" }
    var byStem: [String: [Int]] = [:]
    for (index, a) in audios.enumerated() where a.parsed.part != nil {
        byStem[stemKey(a), default: []].append(index)
    }
    var grouped = Set<Int>()
    var audioGroups: [[ParsedFile]] = []
    for (index, a) in audios.enumerated() {
        if grouped.contains(index) { continue }
        let siblings = a.parsed.part == nil ? [] : byStem[stemKey(a)]!
        let distinctParts = Set(siblings.map { audios[$0].parsed.part }).count == siblings.count
        if siblings.count >= 2 && distinctParts {
            let parts = siblings.sorted { audios[$0].parsed.part! < audios[$1].parsed.part! }
            parts.forEach { grouped.insert($0) }
            audioGroups.append(parts.map { audios[$0] })
        } else {
            grouped.insert(index)
            audioGroups.append([a])
        }
    }

    var groups: [UploadGroup] = audioGroups.enumerated().map { i, parts in
        let lead = parts[0]
        let multi = parts.count > 1
        let title = multi ? (lead.parsed.words.isEmpty ? "" : lead.parsed.partStem) : lead.parsed.title
        return UploadGroup(
            id: "group-\(i + 1)",
            audio: parts.map(\.file),
            pdfs: [],
            title: title.isEmpty ? nil : title,
            recordedAt: lead.parsed.local.flatMap { zonedTimeToUtc($0, timeZone: timeZone) }
        )
    }

    var unmatched: [PairFile] = []
    for pdf in pdfs {
        // Best candidate per group (over its audio parts), then the best and runner-up groups.
        var perGroup: [(group: Int, candidate: Candidate)] = audioGroups.enumerated().map { group, parts in
            var best: Candidate?
            for part in parts {
                let c = scorePair(part, pdf)
                if best == nil || c.score > best!.score || (c.score == best!.score && c.timeGap < best!.timeGap) { best = c }
            }
            return (group, best!)
        }
        perGroup.sort { a, b in
            if a.candidate.score != b.candidate.score { return a.candidate.score > b.candidate.score }
            if a.candidate.timeGap != b.candidate.timeGap { return a.candidate.timeGap < b.candidate.timeGap }
            return a.group < b.group
        }
        let chosen = perGroup.first
        let runnerUp = perGroup.count > 1 ? perGroup[1] : nil
        // Modification time alone only decides when it clearly singles out one recording.
        let timeOnly = chosen.map { $0.candidate.reasons.allSatisfy { $0 == .time } } ?? false
        let ambiguous = timeOnly && runnerUp != nil && runnerUp!.candidate.score >= chosen!.candidate.score - timeMargin
        if let chosen, chosen.candidate.score >= pairThreshold, !ambiguous {
            groups[chosen.group].pdfs.append(PairedPdf(file: pdf.file, reasons: chosen.candidate.reasons))
        } else if groups.count == 1 {
            groups[0].pdfs.append(PairedPdf(file: pdf.file, reasons: [.onlyRecording]))
        } else {
            unmatched.append(pdf.file)
        }
    }

    return PairingResult(groups: groups, unmatched: unmatched, rejected: rejected)
}

/// Moves one PDF to another group (or out of every group with nil), as the user chose.
public func assignPdf(_ result: PairingResult, fileID: String, groupID: String?) -> PairingResult {
    let file = result.groups.flatMap(\.pdfs).map(\.file).first { $0.id == fileID } ?? result.unmatched.first { $0.id == fileID }
    guard let file else { return result }
    var groups = result.groups.map { group -> UploadGroup in
        var group = group
        group.pdfs.removeAll { $0.file.id == fileID }
        return group
    }
    var unmatched = result.unmatched.filter { $0.id != fileID }
    if let index = groups.firstIndex(where: { $0.id == groupID }) {
        groups[index].pdfs.append(PairedPdf(file: file, reasons: []))
    } else {
        unmatched.append(file)
    }
    return PairingResult(groups: groups, unmatched: unmatched, rejected: result.rejected)
}

// MARK: - Helpers (the TypeScript's inline expressions)

/// The wall-clock time in `timeZone` as an instant (seconds 0).
func zonedTimeToUtc(_ local: LocalDateTime, timeZone: TimeZone) -> Date? {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    return calendar.date(from: DateComponents(year: local.year, month: local.month, day: local.day, hour: local.hour, minute: local.minute))
}

private func pad2(_ s: String) -> String { s.count < 2 ? "0" + s : s }

/// `String.prototype.replace(string, replacement)`: the first occurrence of the text.
private func replaceFirstOccurrence(of text: String, in string: String, with replacement: String) -> String {
    guard let range = string.range(of: text) else { return string }
    return string.replacingCharacters(in: range, with: replacement)
}

/// `s.replace(/[_]+/g, " ").replace(/\s+/g, " ").replace(/^[\s\-–—.,]+|[\s\-–—.,]+$/g, "")`
private func tidy(_ s: String) -> String {
    var out = PairingRegex.underscores.replacingAll(in: s, with: " ")
    out = PairingRegex.spaces.replacingAll(in: out, with: " ")
    return PairingRegex.edgePunctuation.replacingAll(in: out, with: "")
}

private func isLetter(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.properties.generalCategory {
    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter: true
    default: false
    }
}

private func isNumber(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.properties.generalCategory {
    case .decimalNumber, .letterNumber, .otherNumber: true
    default: false
    }
}

/// `split(/[^\p{L}\p{N}]+/u)`, then each piece split where letters meet numbers, empties dropped.
private func tokenize(_ s: String) -> [String] {
    var tokens: [String] = []
    var current = String.UnicodeScalarView()
    var previous: Unicode.Scalar?
    func flush() {
        if !current.isEmpty { tokens.append(String(current)) }
        current = String.UnicodeScalarView()
    }
    for scalar in s.unicodeScalars {
        guard isLetter(scalar) || isNumber(scalar) else {
            flush()
            previous = nil
            continue
        }
        if let previous, (isLetter(previous) && isNumber(scalar)) || (isNumber(previous) && isLetter(scalar)) {
            flush()
        }
        current.append(scalar)
        previous = scalar
    }
    flush()
    return tokens
}

/// `/^\p{N}+$/u`
private func isAllNumber(_ token: String) -> Bool {
    !token.isEmpty && token.unicodeScalars.allSatisfy(isNumber)
}

/// `String(Number(t))` for a token of digits: leading zeros go ("07" → "7"); digits JavaScript's
/// Number cannot read (not ASCII) give "NaN", as there.
private func jsNumberString(_ token: String) -> String {
    guard token.unicodeScalars.allSatisfy({ $0.isASCII && $0.properties.numericType == .decimal }) else { return "NaN" }
    let trimmed = token.drop { $0 == "0" }
    return trimmed.isEmpty ? "0" : String(trimmed)
}

/// `[...new Set(array)]`: first occurrences, in order.
private func unique(_ values: [String]) -> [String] {
    var seen = Set<String>()
    return values.filter { seen.insert($0).inserted }
}

/// The TypeScript's regular expressions, compiled once.
enum PairingRegex {
    static let extension_ = Pattern(#"\.([^./\\]+)$"#)
    static let trailingExtension = Pattern(#"\.[^./\\]+$"#)
    static let fullDate = Pattern(#"(?<![0-9])(20[0-9]{2})[-_.\s]?(0[1-9]|1[0-2])[-_.\s]?(0[1-9]|[12][0-9]|3[01])(?:[\sT_-]*([01][0-9]|2[0-3])[:._-]?([0-5][0-9])(?:[:._-]?[0-5][0-9])?)?(?![0-9])"#)
    static let koreanDate = Pattern(#"([0-9]{1,2})월\s*([0-9]{1,2})일"#)
    static let part = Pattern(#"(?:(?:part|pt|파트)[\s_-]*([0-9]{1,2})|(?<![0-9])([0-9]{1,2})[\s_-]*부)(?![\p{L}\p{N}])"#, caseInsensitive: true)
    static let underscores = Pattern(#"[_]+"#)
    static let spaces = Pattern(#"\s+"#)
    static let edgePunctuation = Pattern(#"^[\s\-–—.,]+|[\s\-–—.,]+$"#)

    /// NSRegularExpression with String in, String out.
    struct Pattern: @unchecked Sendable {
        let expression: NSRegularExpression

        init(_ pattern: String, caseInsensitive: Bool = false) {
            expression = try! NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : [])
        }

        func firstMatch(in s: String) -> Match? {
            expression.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)).map(Match.init)
        }

        func replacingFirst(in s: String, with replacement: String) -> String {
            guard let match = expression.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
                  let range = Range(match.range, in: s) else { return s }
            return s.replacingCharacters(in: range, with: replacement)
        }

        func replacingAll(in s: String, with replacement: String) -> String {
            expression.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: NSRegularExpression.escapedTemplate(for: replacement))
        }
    }

    struct Match {
        let result: NSTextCheckingResult

        func text(in s: String) -> String {
            Range(result.range, in: s).map { String(s[$0]) } ?? ""
        }

        func group(_ i: Int, in s: String) -> String? {
            let range = result.range(at: i)
            guard range.location != NSNotFound, let r = Range(range, in: s) else { return nil }
            return String(s[r])
        }
    }
}
