import AppKit
import SwiftUI
import AVFoundation
import Carbon

// MARK: - Models

struct LectureSummary: Identifiable, Decodable, Equatable {
    let id: String
    let share_token: String
    let title: String
    let course: String
    let date_label: String
    let status: String
    let stage_message: String?
    let progress: Int?
    let excerpt: String
    let model_used: String
    let has_audio: Bool
}

struct LecturesListResponse: Decodable {
    let lectures: [LectureSummary]
    let courses: [String]
}

struct LectureDetail: Decodable {
    let id: String
    let share_token: String
    var title: String
    var course: String
    let date_label: String
    let status: String
    let stage_message: String?
    var markdown: String
    let model_used: String
    let has_audio: Bool
}

struct LectureDetailResponse: Decodable {
    let lecture: LectureDetail
}

// MARK: - ViewModel (ObservableObject)

@MainActor
final class LecternStore: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published var lectures: [LectureSummary] = []
    @Published var courses: [String] = ["정보보호개론", "자바프로그래밍", "영어읽기와토론", "대순사상과상생윤리"]
    @Published var activeCourse: String = "ALL"
    @Published var searchQuery: String = ""
    @Published var selectedLecture: LectureDetail? = nil
    @Published var isEditing: Bool = false
    @Published var editTitle: String = ""
    @Published var editCourse: String = ""
    @Published var editMarkdown: String = ""

    @Published var recordCourse: String = UserDefaults.standard.string(forKey: "lectern_course") ?? "정보보호개론"
    @Published var isRecording: Bool = false
    @Published var isUploading: Bool = false
    @Published var elapsedSeconds: Int = 0
    @Published var audioLevel: Float = 0.08
    @Published var statusBanner: String? = nil

    @Published var isPlayingAudio: Bool = false
    @Published var playbackSpeed: Float = 1.0
    @Published var currentAudioTime: Double = 0

    let serverBase = ProcessInfo.processInfo.environment["LECTERN_URL"] ?? "https://lectern.qucord.com"
    var onStatusBarUpdate: ((String) -> Void)?

    private var recorder: AVAudioRecorder?
    private var recTimer: Timer?
    private var recStartTime: Date?
    private var recFileURL: URL?
    private var player: AVPlayer?
    private var timeObserver: Any?

    override init() {
        super.init()
        Task { await fetchLectures() }
    }

    var filteredLectures: [LectureSummary] {
        lectures.filter { item in
            let matchesCourse = (activeCourse == "ALL" || item.course == activeCourse)
            let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let matchesSearch = q.isEmpty ||
                item.title.lowercased().contains(q) ||
                item.course.lowercased().contains(q) ||
                item.excerpt.lowercased().contains(q)
            return matchesCourse && matchesSearch
        }
    }

    func fetchLectures(selectId: String? = nil) async {
        guard let url = URL(string: "\(serverBase)/api/lectures") else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let decoded = try JSONDecoder().decode(LecturesListResponse.self, from: data)
            self.lectures = decoded.lectures
            if !decoded.courses.isEmpty {
                self.courses = decoded.courses
            }
            let target = selectId ?? selectedLecture?.id ?? decoded.lectures.first?.id
            if let t = target {
                await selectLecture(id: t)
            }
        } catch {
            self.statusBanner = "서버 연결 확인 필요: \(error.localizedDescription)"
        }
    }

    func selectLecture(id: String) async {
        guard let url = URL(string: "\(serverBase)/api/lectures/\(id)") else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let decoded = try JSONDecoder().decode(LectureDetailResponse.self, from: data)
            self.selectedLecture = decoded.lecture
            self.isEditing = false
            setupAudioPlayer(for: decoded.lecture)

            if decoded.lecture.status == "processing" {
                Task {
                    try? await Task.sleep(nanoseconds: 2_500_000_000)
                    await fetchLectures(selectId: id)
                }
            }
        } catch {
            self.statusBanner = "노트 로드 실패: \(error.localizedDescription)"
        }
    }

    // MARK: - Audio Player & Timestamp Seeking

    private func setupAudioPlayer(for lecture: LectureDetail) {
        if let obs = timeObserver {
            player?.removeTimeObserver(obs)
            timeObserver = nil
        }
        player?.pause()
        isPlayingAudio = false
        currentAudioTime = 0

        guard lecture.has_audio,
              let audioURL = URL(string: "\(serverBase)/api/lectures/\(lecture.id)/audio") else {
            player = nil
            return
        }

        let item = AVPlayerItem(url: audioURL)
        let av = AVPlayer(playerItem: item)
        self.player = av

        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = av.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            Task { @MainActor in
                self?.currentAudioTime = time.seconds.isFinite ? time.seconds : 0
            }
        }
    }

    func toggleAudioPlayback() {
        guard let player = player else { return }
        if isPlayingAudio {
            player.pause()
            isPlayingAudio = false
        } else {
            player.play()
            player.rate = playbackSpeed
            isPlayingAudio = true
        }
    }

    func seekAudio(to seconds: Double) {
        guard let player = player else {
            showToast("이 노트에는 연결된 원본 오디오가 없습니다.")
            return
        }
        let target = CMTime(seconds: seconds, preferredTimescale: 600)
        player.seek(to: target)
        player.play()
        player.rate = playbackSpeed
        isPlayingAudio = true
        let m = Int(seconds) / 60
        let s = Int(seconds) % 60
        showToast(String(format: "⏱ 오디오 %02d:%02d 지점으로 이동", m, s))
    }

    func setSpeed(_ speed: Float) {
        playbackSpeed = speed
        if isPlayingAudio {
            player?.rate = speed
        }
    }

    // MARK: - Native HE-AAC Recording

    func toggleRecording() {
        if isRecording {
            stopAndUploadRecording()
        } else {
            startRecording()
        }
    }

    func startRecording() {
        UserDefaults.standard.set(recordCourse, forKey: "lectern_course")
        let tmp = FileManager.default.temporaryDirectory
        let fileURL = tmp.appendingPathComponent("lectern_\(Int(Date().timeIntervalSince1970)).m4a")
        recFileURL = fileURL

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32000,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        do {
            let rec = try AVAudioRecorder(url: fileURL, settings: settings)
            rec.isMeteringEnabled = true
            rec.delegate = self
            rec.record()
            self.recorder = rec
            self.recStartTime = Date()
            self.isRecording = true
            self.elapsedSeconds = 0
            self.updateMenuBarLabel()

            recTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self = self, let st = self.recStartTime, let r = self.recorder else { return }
                    self.elapsedSeconds = Int(Date().timeIntervalSince(st))
                    r.updateMeters()
                    let power = r.averagePower(forChannel: 0) // -160..0
                    let normalized = max(0.05, min(1.0, (power + 55.0) / 55.0))
                    self.audioLevel = normalized
                    self.updateMenuBarLabel()
                }
            }
        } catch {
            showToast("마이크 녹음 시작 실패: \(error.localizedDescription)")
        }
    }

    func stopAndUploadRecording() {
        recorder?.stop()
        recorder = nil
        recTimer?.invalidate()
        recTimer = nil
        isRecording = false
        isUploading = true
        updateMenuBarLabel()

        guard let url = recFileURL else {
            isUploading = false
            updateMenuBarLabel()
            return
        }

        Task {
            await uploadAudioFile(fileURL: url, course: recordCourse, deleteAfter: true)
        }
    }

    func pickAndUploadAudioFile() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.prompt = "강의 오디오 증류 시작"
        if panel.runModal() == .OK, let url = panel.url {
            isUploading = true
            updateMenuBarLabel()
            Task {
                await uploadAudioFile(fileURL: url, course: recordCourse, deleteAfter: false)
            }
        }
    }

    func uploadAudioFile(fileURL: URL, course: String, deleteAfter: Bool) async {
        defer {
            if deleteAfter {
                try? FileManager.default.removeItem(at: fileURL)
            }
            isUploading = false
            updateMenuBarLabel()
        }

        guard let endpoint = URL(string: "\(serverBase)/api/ingest/shortcut?wait=false"),
              let audioData = try? Data(contentsOf: fileURL) else {
            showToast("오디오 파일 읽기 실패")
            return
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue("macos-native-menubar", forHTTPHeaderField: "X-Client")

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"course\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(course)\r\n".data(using: .utf8)!)

        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"\(fileURL.lastPathComponent)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: audio/mp4\r\n\r\n".data(using: .utf8)!)
        body.append(audioData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body

        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let newId = json["id"] as? String {
                showToast("⚡ 오디오 업로드 완료! Gemini Flash 증류 시작")
                await fetchLectures(selectId: newId)
            }
        } catch {
            showToast("업로드 실패: \(error.localizedDescription)")
        }
    }

    // MARK: - Edit, Export & Share

    func beginEditing() {
        guard let lec = selectedLecture else { return }
        editTitle = lec.title
        editCourse = lec.course
        editMarkdown = lec.markdown
        isEditing = true
    }

    func saveEdits() async {
        guard let lec = selectedLecture,
              let url = URL(string: "\(serverBase)/api/lectures/\(lec.id)") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "PUT"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload: [String: String] = [
            "title": editTitle,
            "course": editCourse,
            "markdown": editMarkdown
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        do {
            let (_, _) = try await URLSession.shared.data(for: req)
            isEditing = false
            showToast("✅ 강의 노트 저장 완료")
            await fetchLectures(selectId: lec.id)
        } catch {
            showToast("저장 실패: \(error.localizedDescription)")
        }
    }

    func exportMarkdownFile() {
        guard let lec = selectedLecture else { return }
        let savePanel = NSSavePanel()
        savePanel.nameFieldStringValue = "\(lec.course)_\(lec.date_label)_요약.md"
        if savePanel.runModal() == .OK, let targetURL = savePanel.url {
            try? (lec.markdown + "\n").write(to: targetURL, atomically: true, encoding: .utf8)
            showToast("⬇️ 마크다운 파일 저장 완료")
        }
    }

    func exportPdfFile() {
        guard let lec = selectedLecture else { return }
        let savePanel = NSSavePanel()
        savePanel.nameFieldStringValue = "\(lec.course)_\(lec.date_label)_요약.pdf"
        if savePanel.runModal() == .OK, let targetURL = savePanel.url {
            let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 540, height: 740))
            textView.string = lec.markdown
            textView.font = NSFont.systemFont(ofSize: 11.5)
            let pdfData = textView.dataWithPDF(inside: textView.bounds)
            try? pdfData.write(to: targetURL)
            showToast("📄 PDF 파일 저장 완료")
        }
    }

    func copyShareLink() {
        guard let lec = selectedLecture else { return }
        let link = "\(serverBase)/s/\(lec.share_token)"
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(link, forType: .string)
        showToast("🔗 공유 링크 클립보드 복사 완료")
    }

    func showToast(_ message: String) {
        statusBanner = message
        Task {
            try? await Task.sleep(nanoseconds: 2_800_000_000)
            if statusBanner == message {
                statusBanner = nil
            }
        }
    }

    private func updateMenuBarLabel() {
        if isUploading {
            onStatusBarUpdate?("⚡ 증류 중...")
        } else if isRecording {
            let m = String(format: "%02d", elapsedSeconds / 60)
            let s = String(format: "%02d", elapsedSeconds % 60)
            onStatusBarUpdate?("🔴 \(m):\(s)")
        } else {
            onStatusBarUpdate?("📚 Lectern")
        }
    }
}

// MARK: - Native Markdown AST & SwiftUI Renderer

enum MarkdownBlock: Identifiable {
    case heading(level: Int, text: String)
    case filterBadge(isBreak: Bool, text: String)
    case codeBlock(code: String)
    case quote(text: String)
    case bullet(indent: Int, text: String)
    case paragraph(text: String)
    case divider

    var id: UUID { UUID() }
}

func parseMarkdownBlocks(_ md: String) -> [MarkdownBlock] {
    var blocks: [MarkdownBlock] = []
    let lines = md.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    var inCode = false
    var codeLines: [String] = []

    for raw in lines {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("```") {
            if inCode {
                blocks.append(.codeBlock(code: codeLines.joined(separator: "\n")))
                codeLines.removeAll()
                inCode = false
            } else {
                inCode = true
            }
            continue
        }
        if inCode {
            codeLines.append(raw)
            continue
        }
        if trimmed.isEmpty { continue }
        if trimmed == "---" || trimmed == "***" {
            blocks.append(.divider)
            continue
        }
        if trimmed.contains("[쉬는 시간 생략") {
            blocks.append(.filterBadge(isBreak: true, text: trimmed.replacingOccurrences(of: "`", with: "")))
            continue
        }
        if trimmed.contains("[수업 종료 후 녹음 절단") {
            blocks.append(.filterBadge(isBreak: false, text: trimmed.replacingOccurrences(of: "`", with: "")))
            continue
        }
        if trimmed.hasPrefix("#### ") {
            blocks.append(.heading(level: 4, text: String(trimmed.dropFirst(5))))
        } else if trimmed.hasPrefix("### ") {
            blocks.append(.heading(level: 3, text: String(trimmed.dropFirst(4))))
        } else if trimmed.hasPrefix("## ") {
            blocks.append(.heading(level: 2, text: String(trimmed.dropFirst(3))))
        } else if trimmed.hasPrefix("# ") {
            blocks.append(.heading(level: 1, text: String(trimmed.dropFirst(2))))
        } else if trimmed.hasPrefix(">") {
            let q = String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces)
            blocks.append(.quote(text: q))
        } else if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
            let leadingSpaces = raw.prefix(while: { $0 == " " }).count
            blocks.append(.bullet(indent: min(2, leadingSpaces / 2), text: String(trimmed.dropFirst(2))))
        } else {
            blocks.append(.paragraph(text: trimmed))
        }
    }
    return blocks
}

func extractFirstTimestampSeconds(_ text: String) -> (label: String, seconds: Double)? {
    let pattern = #"\[(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*[~-]\s*\d{1,2}:\d{2}(?::\d{2})?)?\]"#
    guard let regex = try? NSRegularExpression(pattern: pattern),
          let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else {
        return nil
    }
    let fullRange = Range(match.range(at: 0), in: text)!
    let label = String(text[fullRange]).trimmingCharacters(in: CharacterSet(charactersIn: "[]"))

    let p1 = Int(text[Range(match.range(at: 1), in: text)!]) ?? 0
    let p2 = Int(text[Range(match.range(at: 2), in: text)!]) ?? 0
    var total = p1 * 60 + p2
    if match.range(at: 3).location != NSNotFound, let r3 = Range(match.range(at: 3), in: text) {
        let p3 = Int(text[r3]) ?? 0
        total = p1 * 3600 + p2 * 60 + p3
    }
    return (label, Double(total))
}

struct NativeMarkdownLineView: View {
    let text: String
    let font: Font
    let color: Color
    let onSeek: (Double) -> Void

    var body: some View {
        let ts = extractFirstTimestampSeconds(text)
        let cleaned = text.replacingOccurrences(of: "**", with: "")
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let ts = ts {
                Button(action: { onSeek(ts.seconds) }) {
                    Text("⏱ \(ts.label)")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundColor(Color(red: 0.38, green: 0.65, blue: 0.98))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.blue.opacity(0.15))
                        .cornerRadius(5)
                }
                .buttonStyle(.plain)
            }
            Text(cleaned)
                .font(font)
                .foregroundColor(color)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct NativeMarkdownView: View {
    let markdown: String
    let onSeek: (Double) -> Void

    var body: some View {
        let blocks = parseMarkdownBlocks(markdown)
        LazyVStack(alignment: .leading, spacing: 10) {
            ForEach(blocks) { block in
                switch block {
                case .heading(let level, let text):
                    NativeMarkdownLineView(
                        text: text,
                        font: level == 1 ? .system(size: 22, weight: .bold) :
                              level == 2 ? .system(size: 17, weight: .bold) :
                              .system(size: 14.5, weight: .semibold),
                        color: level <= 2 ? .white : Color(red: 0.75, green: 0.86, blue: 0.99),
                        onSeek: onSeek
                    )
                    .padding(.top, level == 1 ? 4 : 10)
                case .filterBadge(let isBreak, let text):
                    Text(isBreak ? "☕ \(text)" : "✂️ \(text)")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(isBreak ? Color.orange : Color.green)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background((isBreak ? Color.orange : Color.green).opacity(0.14))
                        .cornerRadius(7)
                case .codeBlock(let code):
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(code)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(Color(white: 0.9))
                            .textSelection(.enabled)
                            .padding(12)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.black.opacity(0.45))
                    .cornerRadius(8)
                case .quote(let text):
                    HStack(spacing: 10) {
                        Rectangle()
                            .fill(Color.blue)
                            .frame(width: 3)
                        NativeMarkdownLineView(
                            text: text,
                            font: .system(size: 13.5),
                            color: Color(white: 0.9),
                            onSeek: onSeek
                        )
                    }
                    .padding(.vertical, 6)
                    .padding(.horizontal, 10)
                    .background(Color.blue.opacity(0.08))
                    .cornerRadius(6)
                case .bullet(let indent, let text):
                    HStack(alignment: .top, spacing: 6) {
                        Text("•")
                            .foregroundColor(.secondary)
                        NativeMarkdownLineView(
                            text: text,
                            font: .system(size: 13.5),
                            color: Color(white: 0.86),
                            onSeek: onSeek
                        )
                    }
                    .padding(.leading, CGFloat(indent * 14))
                case .paragraph(let text):
                    NativeMarkdownLineView(
                        text: text,
                        font: .system(size: 13.5),
                        color: Color(white: 0.86),
                        onSeek: onSeek
                    )
                case .divider:
                    Divider().padding(.vertical, 6)
                }
            }
        }
    }
}

// MARK: - Main Popover SwiftUI View

struct LecternPopoverView: View {
    @ObservedObject var store: LecternStore

    var body: some View {
        HStack(spacing: 0) {
            // Left Sidebar
            VStack(alignment: .leading, spacing: 10) {
                // Header + Recorder Box
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Circle()
                            .fill(store.isRecording ? Color.red : Color.blue)
                            .frame(width: 9, height: 9)
                        Text("LECTERN")
                            .font(.system(size: 14, weight: .heavy))
                        Spacer()
                        Text("⌥Space")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.secondary)
                    }

                    HStack(spacing: 6) {
                        TextField("과목명", text: $store.recordCourse)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12))
                        Button(action: { store.pickAndUploadAudioFile() }) {
                            Text("📂")
                        }
                        .help("오디오 파일 업로드")
                    }

                    if store.isRecording {
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color.white.opacity(0.08))
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color.red)
                                    .frame(width: max(8, geo.size.width * CGFloat(store.audioLevel)))
                            }
                        }
                        .frame(height: 6)
                    }

                    Button(action: { store.toggleRecording() }) {
                        HStack {
                            Spacer()
                            Text(store.isRecording ? "⏹ 녹음 종료 및 노트 증류 (\(store.elapsedSeconds)s)" : "🔴 즉시 강의 녹음 시작")
                                .font(.system(size: 12.5, weight: .semibold))
                            Spacer()
                        }
                        .padding(.vertical, 6)
                        .background(store.isRecording ? Color.red : Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(7)
                    }
                    .buttonStyle(.plain)
                }
                .padding(12)
                .background(Color.white.opacity(0.04))
                .cornerRadius(10)

                // Search Field
                TextField("강의 제목, 과목, 키워드 검색...", text: $store.searchQuery)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12.5))

                // Course Filter Chips
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(["ALL"] + store.courses, id: \.self) { course in
                            let isAct = store.activeCourse == course
                            Button(action: { store.activeCourse = course }) {
                                Text(course == "ALL" ? "전체" : course)
                                    .font(.system(size: 11.5, weight: .semibold))
                                    .padding(.horizontal, 9)
                                    .padding(.vertical, 4)
                                    .background(isAct ? Color.blue.opacity(0.22) : Color.white.opacity(0.06))
                                    .foregroundColor(isAct ? Color(red: 0.4, green: 0.68, blue: 1.0) : .secondary)
                                    .cornerRadius(12)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                // Lecture Cards List
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        ForEach(store.filteredLectures) { item in
                            let selected = store.selectedLecture?.id == item.id
                            Button(action: {
                                Task { await store.selectLecture(id: item.id) }
                            }) {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(item.course)
                                            .font(.system(size: 10.5, weight: .bold))
                                            .foregroundColor(Color(red: 0.4, green: 0.68, blue: 1.0))
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(Color.blue.opacity(0.15))
                                            .cornerRadius(4)
                                        Spacer()
                                        Text(item.date_label)
                                            .font(.system(size: 11, design: .monospaced))
                                            .foregroundColor(.secondary)
                                    }
                                    Text(item.title)
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundColor(.white)
                                        .lineLimit(1)
                                    Text(item.excerpt)
                                        .font(.system(size: 11.5))
                                        .foregroundColor(.secondary)
                                        .lineLimit(2)
                                }
                                .padding(10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(selected ? Color.blue.opacity(0.18) : Color.white.opacity(0.03))
                                .cornerRadius(8)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(12)
            .frame(width: 290)
            .background(Color(red: 0.06, green: 0.07, blue: 0.09))

            Divider()

            // Right Markdown Reader & Audio Pane
            VStack(alignment: .leading, spacing: 0) {
                if let lec = store.selectedLecture {
                    // Toolbar
                    HStack(spacing: 8) {
                        Text(lec.course)
                            .font(.system(size: 11.5, weight: .bold))
                            .foregroundColor(Color(red: 0.4, green: 0.68, blue: 1.0))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Color.blue.opacity(0.16))
                            .cornerRadius(5)
                        Text(lec.date_label)
                            .font(.system(size: 11.5, design: .monospaced))
                            .foregroundColor(.secondary)
                        Text("⚡ \(lec.model_used)")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.secondary)

                        Spacer()

                        Button(store.isEditing ? "취소" : "✏️ 편집") {
                            if store.isEditing { store.isEditing = false } else { store.beginEditing() }
                        }
                        Button("⬇️ MD") { store.exportMarkdownFile() }
                        Button("📄 PDF") { store.exportPdfFile() }
                        Button("🔗 공유") { store.copyShareLink() }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color.white.opacity(0.03))

                    Divider()

                    // Audio Player Bar
                    if lec.has_audio {
                        HStack(spacing: 12) {
                            Button(action: { store.toggleAudioPlayback() }) {
                                Text(store.isPlayingAudio ? "⏸ 일시정지" : "▶️ 오디오 재생")
                                    .font(.system(size: 12, weight: .semibold))
                            }
                            Text(String(format: "%02d:%02d", Int(store.currentAudioTime) / 60, Int(store.currentAudioTime) % 60))
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundColor(.secondary)
                            Spacer()
                            Picker("배속", selection: Binding(
                                get: { store.playbackSpeed },
                                set: { store.setSpeed($0) }
                            )) {
                                Text("1.0x").tag(Float(1.0))
                                Text("1.25x").tag(Float(1.25))
                                Text("1.5x").tag(Float(1.5))
                                Text("2.0x").tag(Float(2.0))
                            }
                            .pickerStyle(.segmented)
                            .frame(width: 190)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color.blue.opacity(0.06))
                        Divider()
                    }

                    if let banner = store.statusBanner {
                        Text(banner)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.blue.opacity(0.35))
                    }

                    // Reader or Editor
                    if store.isEditing {
                        VStack(alignment: .leading, spacing: 8) {
                            TextField("제목", text: $store.editTitle)
                                .textFieldStyle(.roundedBorder)
                            TextField("과목", text: $store.editCourse)
                                .textFieldStyle(.roundedBorder)
                            TextEditor(text: $store.editMarkdown)
                                .font(.system(size: 13, design: .monospaced))
                            HStack {
                                Spacer()
                                Button("💾 변경사항 저장") {
                                    Task { await store.saveEdits() }
                                }
                                .buttonStyle(.borderedProminent)
                            }
                        }
                        .padding(16)
                    } else {
                        ScrollView {
                            NativeMarkdownView(markdown: lec.markdown) { sec in
                                store.seekAudio(to: sec)
                            }
                            .padding(20)
                        }
                    }
                } else {
                    VStack {
                        Spacer()
                        Text("왼쪽 목록에서 강의 노트를 선택하거나 새 강의를 녹음하세요.")
                            .foregroundColor(.secondary)
                        Spacer()
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(red: 0.04, green: 0.05, blue: 0.06))
        }
        .frame(width: 940, height: 640)
        .preferredColorScheme(.dark)
    }
}

// MARK: - AppDelegate & Carbon Global Hotkey (⌥Space)

private var sharedAppDelegate: AppDelegate?

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var popover: NSPopover!
    private var store: LecternStore!
    private var hotKeyRef: EventHotKeyRef?

    @MainActor
    func applicationDidFinishLaunching(_ notification: Notification) {
        sharedAppDelegate = self
        NSApp.setActivationPolicy(.accessory)

        store = LecternStore()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "📚 Lectern"

        store.onStatusBarUpdate = { [weak self] label in
            self?.statusItem.button?.title = label
        }

        if let button = statusItem.button {
            button.target = self
            button.action = #selector(handleStatusBarClick(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        let hostVC = NSHostingController(rootView: LecternPopoverView(store: store))
        popover = NSPopover()
        popover.contentSize = NSSize(width: 940, height: 640)
        popover.behavior = .transient
        popover.contentViewController = hostVC

        registerGlobalHotKey()
    }

    @MainActor
    @objc private func handleStatusBarClick(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else { return }
        if event.type == .rightMouseUp {
            store.toggleRecording()
        } else {
            if popover.isShown {
                popover.performClose(sender)
            } else if let button = statusItem.button {
                Task { await store.fetchLectures() }
                popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
                NSApp.activate(ignoringOtherApps: true)
            }
        }
    }

    @MainActor
    func triggerGlobalHotKey() {
        store.toggleRecording()
    }

    private func registerGlobalHotKey() {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )

        InstallEventHandler(
            GetApplicationEventTarget(),
            { (_, _, _) -> OSStatus in
                Task { @MainActor in
                    sharedAppDelegate?.triggerGlobalHotKey()
                }
                return noErr
            },
            1,
            &eventType,
            nil,
            nil
        )

        let hotKeyID = EventHotKeyID(signature: OSType(0x4C454354), id: 1) // 'LECT'
        RegisterEventHotKey(
            UInt32(kVK_Space),
            UInt32(optionKey),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
