import AppKit
import SwiftUI
import AVFoundation
import Carbon

// MARK: - Elysium Design System v1.0 Tokens (macOS Native Dark)

enum Elysium {
    static let surfaceCanvas = Color(red: 11/255, green: 13/255, blue: 17/255)      // #0B0D11
    static let surfaceElevated = Color(red: 20/255, green: 23/255, blue: 29/255)    // #14171D
    static let surfaceSubtle = Color(red: 28/255, green: 32/255, blue: 40/255)      // #1C2028
    static let surfaceInteractive = Color(red: 38/255, green: 43/255, blue: 53/255) // #262B35

    static let textPrimary = Color(red: 242/255, green: 244/255, blue: 246/255)     // #F2F4F6
    static let textSecondary = Color(red: 158/255, green: 166/255, blue: 178/255)   // #9EA6B2
    static let textTertiary = Color(red: 107/255, green: 118/255, blue: 132/255)    // #6B7684

    static let actionPrimary = Color(red: 69/255, green: 147/255, blue: 252/255)    // #4593FC
    static let actionPrimarySubtle = Color(red: 69/255, green: 147/255, blue: 252/255).opacity(0.14)

    static let statusSuccessFg = Color(red: 21/255, green: 196/255, blue: 126/255)  // #15C47E
    static let statusSuccessBg = Color(red: 21/255, green: 196/255, blue: 126/255).opacity(0.14)
    static let statusWarningFg = Color(red: 255/255, green: 176/255, blue: 32/255)  // #FFB020
    static let statusWarningBg = Color(red: 255/255, green: 176/255, blue: 32/255).opacity(0.14)
    static let statusDangerFg = Color(red: 245/255, green: 88/255, blue: 100/255)   // #F55864
    static let statusDangerBg = Color(red: 245/255, green: 88/255, blue: 100/255).opacity(0.14)
}

// MARK: - Models

struct AuthUser: Decodable {
    let id: String
    let email: String
    let displayName: String
    let apiToken: String
}

struct AuthLoginResponse: Decodable {
    let ok: Bool?
    let token: String?
    let user: AuthUser?
    let error: String?
}

struct LectureSummary: Identifiable, Decodable, Equatable {
    let id: String
    let share_token: String
    let is_public: Bool?
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

struct LectureDetail: Decodable, Equatable {
    let id: String
    let share_token: String
    var is_public: Bool?
    var title: String
    var course: String
    let date_label: String
    let status: String
    let stage_message: String?
    let progress: Int?
    var markdown: String
    let model_used: String
    let has_audio: Bool
}

struct LectureDetailResponse: Decodable {
    let lecture: LectureDetail
}

// MARK: - Pre-Parsed Deterministic Markdown Block Model (No Dynamic UUID Hang)

enum MarkdownBlockKind: Equatable {
    case heading(level: Int)
    case filterBadge(isBreak: Bool)
    case codeBlock
    case quote
    case bullet(indent: Int)
    case paragraph
    case divider
}

struct MarkdownBlock: Identifiable, Equatable {
    let id: Int
    let kind: MarkdownBlockKind
    let text: String
    let tsLabel: String?
    let tsSeconds: Double?
}

private let timestampRegex: NSRegularExpression? = try? NSRegularExpression(
    pattern: #"\[(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*[~-]\s*\d{1,2}:\d{2}(?::\d{2})?)?\]"#
)

func extractFirstTimestampSeconds(_ text: String) -> (label: String, seconds: Double)? {
    guard let regex = timestampRegex,
          let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
          let fullRange = Range(match.range(at: 0), in: text),
          let r1 = Range(match.range(at: 1), in: text),
          let r2 = Range(match.range(at: 2), in: text) else {
        return nil
    }
    let label = String(text[fullRange]).trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
    let p1 = Int(text[r1]) ?? 0
    let p2 = Int(text[r2]) ?? 0
    var total = p1 * 60 + p2
    if match.range(at: 3).location != NSNotFound, let r3 = Range(match.range(at: 3), in: text) {
        let p3 = Int(text[r3]) ?? 0
        total = p1 * 3600 + p2 * 60 + p3
    }
    return (label, Double(total))
}

func parseMarkdownBlocks(_ md: String) -> [MarkdownBlock] {
    var blocks: [MarkdownBlock] = []
    let lines = md.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    var inCode = false
    var codeLines: [String] = []
    var nextId = 0

    func appendBlock(_ kind: MarkdownBlockKind, rawText: String, parseTs: Bool = true) {
        let ts = parseTs ? extractFirstTimestampSeconds(rawText) : nil
        let cleaned = parseTs ? rawText.replacingOccurrences(of: "**", with: "") : rawText
        blocks.append(
            MarkdownBlock(
                id: nextId,
                kind: kind,
                text: cleaned,
                tsLabel: ts?.label,
                tsSeconds: ts?.seconds
            )
        )
        nextId += 1
    }

    for raw in lines {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("```") {
            if inCode {
                appendBlock(.codeBlock, rawText: codeLines.joined(separator: "\n"), parseTs: false)
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
            appendBlock(.divider, rawText: "", parseTs: false)
            continue
        }
        if trimmed.contains("[쉬는 시간 생략") {
            appendBlock(.filterBadge(isBreak: true), rawText: trimmed.replacingOccurrences(of: "`", with: ""), parseTs: false)
            continue
        }
        if trimmed.contains("[수업 종료 후 녹음 절단") {
            appendBlock(.filterBadge(isBreak: false), rawText: trimmed.replacingOccurrences(of: "`", with: ""), parseTs: false)
            continue
        }
        if trimmed.hasPrefix("#### ") {
            appendBlock(.heading(level: 4), rawText: String(trimmed.dropFirst(5)))
        } else if trimmed.hasPrefix("### ") {
            appendBlock(.heading(level: 3), rawText: String(trimmed.dropFirst(4)))
        } else if trimmed.hasPrefix("## ") {
            appendBlock(.heading(level: 2), rawText: String(trimmed.dropFirst(3)))
        } else if trimmed.hasPrefix("# ") {
            appendBlock(.heading(level: 1), rawText: String(trimmed.dropFirst(2)))
        } else if trimmed.hasPrefix(">") {
            let q = String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces)
            appendBlock(.quote, rawText: q)
        } else if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
            let leadingSpaces = raw.prefix(while: { $0 == " " }).count
            appendBlock(.bullet(indent: min(2, leadingSpaces / 2)), rawText: String(trimmed.dropFirst(2)))
        } else {
            appendBlock(.paragraph, rawText: trimmed)
        }
    }
    return blocks
}

struct PendingLocalUpload: Codable, Identifiable {
    let id: String
    let filePath: String
    let course: String
    let createdAt: String
    var lastError: String
}

// MARK: - ViewModel (ObservableObject)

@MainActor
final class LecternStore: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published var authToken: String = UserDefaults.standard.string(forKey: "lectern_auth_token")
        ?? ProcessInfo.processInfo.environment["LECTERN_TOKEN"]
        ?? ""
    @Published var currentUserLabel: String = UserDefaults.standard.string(forKey: "lectern_user_label") ?? ""
    @Published var loginEmail: String = "sunwoo"
    @Published var loginPassword: String = ""
    @Published var loginError: String? = nil
    @Published var isLoggingIn: Bool = false

    @Published var lectures: [LectureSummary] = []
    @Published var courses: [String] = ["정보보호개론", "자바프로그래밍", "영어읽기와토론", "대순사상과상생윤리"]
    @Published var activeCourse: String = "ALL"
    @Published var searchQuery: String = ""
    @Published var selectedLecture: LectureDetail? = nil
    @Published var parsedBlocks: [MarkdownBlock] = []
    @Published var isLoadingLectures: Bool = false

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
    @Published var pendingUploads: [PendingLocalUpload] = []

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
    private var playerLectureId: String?
    private var timeObserver: Any?
    private var processingWatchTask: Task<Void, Never>?

    var localVaultDir: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents")
        let dir = docs.appendingPathComponent("LecternRecordings", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    var pendingManifestURL: URL {
        localVaultDir.appendingPathComponent("pending_uploads.json")
    }

    override init() {
        super.init()
        loadPendingUploadsManifest()
        if !authToken.isEmpty {
            Task {
                await fetchLectures()
                await retryAllPendingUploads()
            }
        }
    }

    func loadPendingUploadsManifest() {
        guard let data = try? Data(contentsOf: pendingManifestURL),
              let list = try? JSONDecoder().decode([PendingLocalUpload].self, from: data) else {
            pendingUploads = []
            return
        }
        pendingUploads = list.filter { FileManager.default.fileExists(atPath: $0.filePath) }
    }

    func savePendingUploadsManifest() {
        if let data = try? JSONEncoder().encode(pendingUploads) {
            try? data.write(to: pendingManifestURL, options: .atomic)
        }
    }

    func openLocalVaultFolder() {
        NSWorkspace.shared.open(localVaultDir)
    }

    var isAuthenticated: Bool {
        !authToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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

    private func authorizedRequest(url: URL, method: String = "GET") -> URLRequest {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 15
        if !authToken.isEmpty {
            req.setValue(authToken, forHTTPHeaderField: "X-Lectern-Token")
        }
        return req
    }

    func performLogin() async {
        guard let url = URL(string: "\(serverBase)/api/auth/login") else { return }
        isLoggingIn = true
        loginError = nil
        defer { isLoggingIn = false }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: String] = [
            "email": loginEmail.trimmingCharacters(in: .whitespacesAndNewlines),
            "password": loginPassword
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let http = resp as? HTTPURLResponse
            let decoded = try JSONDecoder().decode(AuthLoginResponse.self, from: data)
            if http?.statusCode == 200, let user = decoded.user {
                self.authToken = user.apiToken
                self.currentUserLabel = "\(user.displayName) (\(user.email))"
                UserDefaults.standard.set(user.apiToken, forKey: "lectern_auth_token")
                UserDefaults.standard.set(self.currentUserLabel, forKey: "lectern_user_label")
                self.loginPassword = ""
                await fetchLectures()
            } else {
                self.loginError = decoded.error ?? "로그인에 실패했습니다."
            }
        } catch {
            self.loginError = "서버 연결 오류: \(error.localizedDescription)"
        }
    }

    func logout() {
        stopAudioPlayer()
        authToken = ""
        currentUserLabel = ""
        lectures = []
        selectedLecture = nil
        parsedBlocks = []
        UserDefaults.standard.removeObject(forKey: "lectern_auth_token")
        UserDefaults.standard.removeObject(forKey: "lectern_user_label")
    }

    func fetchLectures(selectId: String? = nil) async {
        guard isAuthenticated, !isLoadingLectures else { return }
        guard let url = URL(string: "\(serverBase)/api/lectures") else { return }
        isLoadingLectures = true
        defer { isLoadingLectures = false }

        do {
            let req = authorizedRequest(url: url)
            let (data, resp) = try await URLSession.shared.data(for: req)
            if (resp as? HTTPURLResponse)?.statusCode == 401 {
                logout()
                loginError = "세션이 만료되었습니다. 다시 로그인해주세요."
                return
            }
            let decoded = try JSONDecoder().decode(LecturesListResponse.self, from: data)
            let prevProcessingIds = Set(self.lectures.filter { $0.status == "processing" }.map { $0.id })
            self.lectures = decoded.lectures
            if !decoded.courses.isEmpty {
                self.courses = decoded.courses
            }
            let target = selectId ?? selectedLecture?.id ?? decoded.lectures.first?.id
            if let t = target {
                let justFinished = prevProcessingIds.contains(t) && (decoded.lectures.first(where: { $0.id == t })?.status == "done")
                if selectedLecture?.id != t || selectId != nil || justFinished || selectedLecture?.status == "processing" {
                    await selectLecture(id: t)
                }
            }
            ensureProcessingWatchLoop()
        } catch {
            self.statusBanner = "서버 연결 확인 필요: \(error.localizedDescription)"
        }
    }

    private func ensureProcessingWatchLoop() {
        let hasProcessing = lectures.contains(where: { $0.status == "processing" }) || selectedLecture?.status == "processing"
        guard hasProcessing else {
            processingWatchTask?.cancel()
            processingWatchTask = nil
            return
        }
        guard processingWatchTask == nil else { return }
        processingWatchTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_200_000_000)
                guard let strongSelf = self, strongSelf.isAuthenticated else { break }
                let stillProcessing = strongSelf.lectures.contains(where: { $0.status == "processing" }) || strongSelf.selectedLecture?.status == "processing"
                if !stillProcessing { break }
                await strongSelf.fetchLectures()
            }
            self?.processingWatchTask = nil
        }
    }

    func selectLecture(id: String) async {
        guard isAuthenticated else { return }
        guard let url = URL(string: "\(serverBase)/api/lectures/\(id)") else { return }
        do {
            let req = authorizedRequest(url: url)
            let (data, resp) = try await URLSession.shared.data(for: req)
            if (resp as? HTTPURLResponse)?.statusCode == 401 {
                logout()
                return
            }
            let decoded = try JSONDecoder().decode(LectureDetailResponse.self, from: data)
            if playerLectureId != decoded.lecture.id {
                stopAudioPlayer()
            }
            self.selectedLecture = decoded.lecture
            if decoded.lecture.status == "processing" {
                let msg = decoded.lecture.stage_message ?? "강의 오디오 증류 중..."
                let pct = decoded.lecture.progress ?? 20
                self.parsedBlocks = parseMarkdownBlocks("# \(msg) (\(pct)%)\n\n쉬는 시간과 불필요한 잡담을 걸러내고 핵심 이론을 구조화하고 있습니다. 완료되면 자동으로 노트가 열립니다.")
                ensureProcessingWatchLoop()
            } else {
                self.parsedBlocks = parseMarkdownBlocks(decoded.lecture.markdown)
            }
            self.isEditing = false
        } catch {
            self.statusBanner = "노트 로드 실패: \(error.localizedDescription)"
        }
    }

    // MARK: - Lazy Audio Player & Timestamp Seeking

    private func stopAudioPlayer() {
        if let obs = timeObserver {
            player?.removeTimeObserver(obs)
            timeObserver = nil
        }
        player?.pause()
        player = nil
        playerLectureId = nil
        isPlayingAudio = false
        currentAudioTime = 0
    }

    private func ensureAudioPlayer() -> AVPlayer? {
        guard let lecture = selectedLecture, lecture.has_audio else { return nil }
        if let existing = player, playerLectureId == lecture.id {
            return existing
        }
        stopAudioPlayer()
        let encodedTok = authToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        guard let audioURL = URL(string: "\(serverBase)/api/lectures/\(lecture.id)/audio?token=\(encodedTok)") else {
            return nil
        }

        let item = AVPlayerItem(url: audioURL)
        let av = AVPlayer(playerItem: item)
        self.player = av
        self.playerLectureId = lecture.id

        let interval = CMTime(seconds: 1.0, preferredTimescale: 600)
        timeObserver = av.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            let sec = time.seconds.isFinite ? time.seconds : 0
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                if abs(self.currentAudioTime - sec) >= 0.8 {
                    self.currentAudioTime = sec
                }
            }
        }
        return av
    }

    func toggleAudioPlayback() {
        guard let av = ensureAudioPlayer() else { return }
        if isPlayingAudio {
            av.pause()
            isPlayingAudio = false
        } else {
            av.play()
            av.rate = playbackSpeed
            isPlayingAudio = true
        }
    }

    func seekAudio(to seconds: Double) {
        guard let av = ensureAudioPlayer() else {
            showToast("이 노트에는 연결된 원본 오디오가 없습니다.")
            return
        }
        let target = CMTime(seconds: seconds, preferredTimescale: 600)
        av.seek(to: target)
        av.play()
        av.rate = playbackSpeed
        isPlayingAudio = true
        currentAudioTime = seconds
        let m = Int(seconds) / 60
        let s = Int(seconds) % 60
        showToast(String(format: "오디오 %02d:%02d 지점으로 이동", m, s))
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
        guard isAuthenticated else {
            showToast("먼저 계정에 로그인해주세요.")
            return
        }
        UserDefaults.standard.set(recordCourse, forKey: "lectern_course")
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyyMMdd_HHmmss"
        let stamp = fmt.string(from: Date())
        let safeCourse = recordCourse.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: " ", with: "_")
        let fileURL = localVaultDir.appendingPathComponent("\(safeCourse)_\(stamp).m4a")
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
            showToast("로컬 원본 자동 저장 중: ~/Documents/LecternRecordings")

            recTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let strongSelf = self,
                          let st = strongSelf.recStartTime,
                          let r = strongSelf.recorder else { return }
                    strongSelf.elapsedSeconds = Int(Date().timeIntervalSince(st))
                    r.updateMeters()
                    let power = r.averagePower(forChannel: 0)
                    let normalized = max(0.05, min(1.0, (power + 55.0) / 55.0))
                    strongSelf.audioLevel = normalized
                    strongSelf.updateMenuBarLabel()
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

        let localId = "mac_\(url.lastPathComponent)"
        let pendingItem = PendingLocalUpload(
            id: localId,
            filePath: url.path,
            course: recordCourse,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            lastError: "업로드 대기 중..."
        )
        pendingUploads.removeAll { $0.id == localId }
        pendingUploads.insert(pendingItem, at: 0)
        savePendingUploadsManifest()

        Task {
            await uploadAudioFile(fileURL: url, course: recordCourse, idempotencyKey: localId)
        }
    }

    func pickAndUploadAudioFile() {
        guard isAuthenticated else {
            showToast("먼저 계정에 로그인해주세요.")
            return
        }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.prompt = "강의 오디오 증류 시작"
        if panel.runModal() == .OK, let url = panel.url {
            isUploading = true
            updateMenuBarLabel()
            let localId = "mac_pick_\(url.lastPathComponent)_\(Int(Date().timeIntervalSince1970))"
            Task {
                await uploadAudioFile(fileURL: url, course: recordCourse, idempotencyKey: localId)
            }
        }
    }

    func retryAllPendingUploads() async {
        guard isAuthenticated, !pendingUploads.isEmpty else { return }
        let items = pendingUploads
        for item in items {
            let url = URL(fileURLWithPath: item.filePath)
            if FileManager.default.fileExists(atPath: item.filePath) {
                await uploadAudioFile(fileURL: url, course: item.course, idempotencyKey: item.id)
            } else {
                pendingUploads.removeAll { $0.id == item.id }
                savePendingUploadsManifest()
            }
        }
    }

    func retryServerDistillation(id: String) async {
        guard let url = URL(string: "\(serverBase)/api/lectures/\(id)/retry") else { return }
        let req = authorizedRequest(url: url, method: "POST")
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            if (resp as? HTTPURLResponse)?.statusCode == 200 {
                showToast("보존된 원본 오디오로 재분석을 시작합니다.")
                await fetchLectures(selectId: id)
            } else {
                showToast("재분석 요청 실패")
            }
        } catch {
            showToast("서버 연결 오류: \(error.localizedDescription)")
        }
    }

    func uploadAudioFile(fileURL: URL, course: String, idempotencyKey: String) async {
        defer {
            isUploading = false
            updateMenuBarLabel()
        }

        guard let endpoint = URL(string: "\(serverBase)/api/ingest/shortcut?wait=false"),
              let audioData = try? Data(contentsOf: fileURL) else {
            showToast("오디오 파일 읽기 실패")
            return
        }

        let maxAttempts = 3
        var lastErrorMsg = "네트워크 오류"

        for attempt in 1...maxAttempts {
            if attempt > 1 {
                showToast("업로드 자동 재시도 중 (\(attempt)/\(maxAttempts))...")
                try? await Task.sleep(nanoseconds: UInt64(attempt) * 2_000_000_000)
            }

            let boundary = "Boundary-\(UUID().uuidString)"
            var req = authorizedRequest(url: endpoint, method: "POST")
            req.timeoutInterval = 180
            req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            req.setValue("macos-native-menubar", forHTTPHeaderField: "X-Client")
            req.setValue(idempotencyKey, forHTTPHeaderField: "X-Idempotency-Key")

            var body = Data()
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"course\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(course)\r\n".data(using: .utf8)!)

            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"idempotency_key\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(idempotencyKey)\r\n".data(using: .utf8)!)

            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"\(fileURL.lastPathComponent)\"\r\n".data(using: .utf8)!)
            body.append("Content-Type: audio/mp4\r\n\r\n".data(using: .utf8)!)
            body.append(audioData)
            body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
            req.httpBody = body

            do {
                let (data, resp) = try await URLSession.shared.data(for: req)
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                if code >= 200 && code < 300,
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let newId = json["id"] as? String {
                    pendingUploads.removeAll { $0.id == idempotencyKey }
                    savePendingUploadsManifest()
                    showToast("업로드 완료 (원본 로컬 보존됨) · 실시간 증류 시작")
                    await fetchLectures(selectId: newId)
                    return
                } else {
                    lastErrorMsg = "HTTP \(code)"
                }
            } catch {
                lastErrorMsg = error.localizedDescription
            }
        }

        if let idx = pendingUploads.firstIndex(where: { $0.id == idempotencyKey }) {
            pendingUploads[idx].lastError = "업로드 지연 (\(lastErrorMsg)) · 로컬 보존됨"
        } else {
            pendingUploads.insert(
                PendingLocalUpload(
                    id: idempotencyKey,
                    filePath: fileURL.path,
                    course: course,
                    createdAt: ISO8601DateFormatter().string(from: Date()),
                    lastError: "업로드 지연 (\(lastErrorMsg)) · 로컬 보존됨"
                ),
                at: 0
            )
        }
        savePendingUploadsManifest()
        showToast("업로드 지연: 원본이 ~/Documents/LecternRecordings 에 안전 보관되었습니다.")
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
        var req = authorizedRequest(url: url, method: "PUT")
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
            showToast("강의 노트 저장 완료")
            await selectLecture(id: lec.id)
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
            showToast("마크다운 파일 저장 완료")
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
            showToast("PDF 파일 저장 완료")
        }
    }

    func copyShareLink() {
        guard let lec = selectedLecture else { return }
        if !(lec.is_public ?? false) {
            Task {
                await toggleVisibility(forcePublic: true)
                let link = "\(serverBase)/s/\(lec.share_token)"
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(link, forType: .string)
                showToast("노트를 '공개'로 전환하고 공유 링크를 복사했습니다.")
            }
            return
        }
        let link = "\(serverBase)/s/\(lec.share_token)"
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(link, forType: .string)
        showToast("공개 공유 링크 클립보드 복사 완료")
    }

    func toggleVisibility(forcePublic: Bool? = nil) async {
        guard let lec = selectedLecture,
              let url = URL(string: "\(serverBase)/api/lectures/\(lec.id)/visibility") else { return }
        let nextPublic = forcePublic ?? !(lec.is_public ?? false)
        var req = authorizedRequest(url: url, method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["is_public": nextPublic])
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            if (resp as? HTTPURLResponse)?.statusCode == 200 {
                self.selectedLecture?.is_public = nextPublic
                showToast(nextPublic ? "공유 링크 공개로 전환됨" : "비공개로 전환됨 (외부 접근 차단)")
                await fetchLectures(selectId: lec.id)
            }
        } catch {
            showToast("공개 설정 변경 실패: \(error.localizedDescription)")
        }
    }

    func deleteLecture(id: String) async {
        guard let url = URL(string: "\(serverBase)/api/lectures/\(id)") else { return }
        let req = authorizedRequest(url: url, method: "DELETE")
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            if (resp as? HTTPURLResponse)?.statusCode == 200 {
                if selectedLecture?.id == id {
                    stopAudioPlayer()
                    selectedLecture = nil
                    parsedBlocks = []
                }
                showToast("강의 노트가 영구 삭제되었습니다.")
                await fetchLectures()
            }
        } catch {
            showToast("삭제 실패: \(error.localizedDescription)")
        }
    }

    func cleanupShortAndFailedLectures() async {
        guard let url = URL(string: "\(serverBase)/api/lectures/cleanup") else { return }
        var req = authorizedRequest(url: url, method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["mode": "short_fragments"])
        do {
            let (data, _) = try await URLSession.shared.data(for: req)
            let count = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["affectedCount"] as? Int ?? 0
            showToast("짧은 테스트/실패 기록 \(count)건 정리 완료")
            await fetchLectures()
        } catch {
            showToast("정리 실패: \(error.localizedDescription)")
        }
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
            onStatusBarUpdate?("Lectern · 증류 중")
        } else if isRecording {
            let m = String(format: "%02d", elapsedSeconds / 60)
            let s = String(format: "%02d", elapsedSeconds % 60)
            onStatusBarUpdate?("REC \(m):\(s)")
        } else {
            onStatusBarUpdate?("Lectern")
        }
    }
}

// MARK: - Native Markdown Line & View (Deterministic, Non-Recursive Layout)

struct NativeMarkdownLineView: View {
    let block: MarkdownBlock
    let font: Font
    let color: Color
    let onSeek: (Double) -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let label = block.tsLabel, let sec = block.tsSeconds {
                Button(action: { onSeek(sec) }) {
                    Text(label)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundColor(Elysium.actionPrimary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Elysium.actionPrimarySubtle)
                        .cornerRadius(6)
                }
                .buttonStyle(.plain)
            }
            Text(block.text)
                .font(font)
                .foregroundColor(color)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct NativeMarkdownView: View {
    let blocks: [MarkdownBlock]
    let onSeek: (Double) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(blocks) { block in
                switch block.kind {
                case .heading(let level):
                    NativeMarkdownLineView(
                        block: block,
                        font: level == 1 ? .system(size: 21, weight: .bold) :
                              level == 2 ? .system(size: 16.5, weight: .bold) :
                              .system(size: 14, weight: .semibold),
                        color: Elysium.textPrimary,
                        onSeek: onSeek
                    )
                    .padding(.top, level == 1 ? 4 : 10)
                case .filterBadge(let isBreak):
                    Text(block.text)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(isBreak ? Elysium.statusWarningFg : Elysium.statusSuccessFg)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(isBreak ? Elysium.statusWarningBg : Elysium.statusSuccessBg)
                        .cornerRadius(999)
                case .codeBlock:
                    ScrollView(.horizontal, showsIndicators: false) {
                        Text(block.text)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(Elysium.textPrimary)
                            .padding(12)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Elysium.surfaceElevated)
                    .cornerRadius(12)
                case .quote:
                    HStack(spacing: 10) {
                        Rectangle()
                            .fill(Elysium.actionPrimary)
                            .frame(width: 3)
                        NativeMarkdownLineView(
                            block: block,
                            font: .system(size: 13.5),
                            color: Elysium.textPrimary,
                            onSeek: onSeek
                        )
                    }
                    .padding(.vertical, 6)
                    .padding(.horizontal, 10)
                    .background(Elysium.actionPrimarySubtle)
                    .cornerRadius(8)
                case .bullet(let indent):
                    HStack(alignment: .top, spacing: 6) {
                        Text("•")
                            .foregroundColor(Elysium.textTertiary)
                        NativeMarkdownLineView(
                            block: block,
                            font: .system(size: 13.5),
                            color: Elysium.textSecondary,
                            onSeek: onSeek
                        )
                    }
                    .padding(.leading, CGFloat(indent * 14))
                case .paragraph:
                    NativeMarkdownLineView(
                        block: block,
                        font: .system(size: 13.5),
                        color: Elysium.textSecondary,
                        onSeek: onSeek
                    )
                case .divider:
                    Divider().padding(.vertical, 6)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Main Popover SwiftUI View

struct LecternPopoverView: View {
    @ObservedObject var store: LecternStore

    var body: some View {
        if !store.isAuthenticated {
            // Elysium Native Login Gate
            VStack(spacing: 16) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(Elysium.actionPrimary)
                        .frame(width: 10, height: 10)
                    Text("Lectern")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundColor(Elysium.textPrimary)
                }
                Text("내 계정에 로그인하여 개인 강의 녹음과 마크다운 노트를 동기화하세요.")
                    .font(.system(size: 13))
                    .foregroundColor(Elysium.textSecondary)
                    .multilineTextAlignment(.center)

                VStack(alignment: .leading, spacing: 10) {
                    Text("아이디 또는 이메일")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(Elysium.textSecondary)
                    TextField("sunwoo 또는 이메일", text: $store.loginEmail)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 300)

                    Text("비밀번호")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(Elysium.textSecondary)
                    SecureField("비밀번호 입력", text: $store.loginPassword)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 300)
                        .onSubmit {
                            Task { await store.performLogin() }
                        }

                    if let err = store.loginError {
                        Text(err)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(Elysium.statusDangerFg)
                    }

                    Button(action: {
                        Task { await store.performLogin() }
                    }) {
                        HStack {
                            Spacer()
                            Text(store.isLoggingIn ? "로그인 중..." : "내 워크스페이스 열기")
                                .font(.system(size: 13.5, weight: .semibold))
                            Spacer()
                        }
                        .padding(.vertical, 8)
                        .background(Elysium.actionPrimary)
                        .foregroundColor(.white)
                        .cornerRadius(8)
                    }
                    .buttonStyle(.plain)
                    .frame(width: 300)
                    .disabled(store.isLoggingIn)
                }
                .padding(24)
                .background(Elysium.surfaceElevated)
                .cornerRadius(16)
            }
            .frame(width: 940, height: 640)
            .background(Elysium.surfaceCanvas)
            .preferredColorScheme(.dark)
        } else {
            HStack(spacing: 0) {
                // Left Sidebar (Elysium Surface Elevated #14171D)
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Circle()
                                .fill(store.isRecording ? Elysium.statusDangerFg : Elysium.actionPrimary)
                                .frame(width: 9, height: 9)
                            Text("Lectern")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundColor(Elysium.textPrimary)
                            Spacer()
                            Text("⌥Space")
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(Elysium.textTertiary)
                        }

                        HStack(spacing: 6) {
                            TextField("과목명", text: $store.recordCourse)
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 12))
                            Button(action: { store.pickAndUploadAudioFile() }) {
                                Text("파일")
                                    .font(.system(size: 11.5, weight: .semibold))
                            }
                            .help("오디오 파일 업로드")
                            Button(action: { store.openLocalVaultFolder() }) {
                                Text("원본폴더")
                                    .font(.system(size: 11.5, weight: .semibold))
                            }
                            .help("로컬 원본 녹음 보관 폴더 열기 (~/Documents/LecternRecordings)")
                        }

                        if !store.pendingUploads.isEmpty {
                            HStack(spacing: 6) {
                                Text("미전송 원본 \(store.pendingUploads.count)건 보호됨")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(Elysium.statusWarningFg)
                                Spacer()
                                Button("재업로드") {
                                    Task { await store.retryAllPendingUploads() }
                                }
                                .font(.system(size: 11, weight: .semibold))
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .background(Elysium.statusWarningBg)
                            .cornerRadius(6)
                        }

                        if store.isRecording {
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(Elysium.surfaceInteractive)
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(Elysium.statusDangerFg)
                                        .frame(width: max(8, geo.size.width * CGFloat(store.audioLevel)))
                                }
                            }
                            .frame(height: 6)
                        }

                        Button(action: { store.toggleRecording() }) {
                            HStack {
                                Spacer()
                                Text(store.isRecording ? "녹음 종료 및 노트 증류 (\(store.elapsedSeconds)s)" : "즉시 강의 녹음 시작")
                                    .font(.system(size: 12.5, weight: .semibold))
                                Spacer()
                            }
                            .padding(.vertical, 7)
                            .background(store.isRecording ? Elysium.statusDangerFg : Elysium.actionPrimary)
                            .foregroundColor(.white)
                            .cornerRadius(8)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(12)
                    .background(Elysium.surfaceSubtle)
                    .cornerRadius(12)

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
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 4)
                                        .background(isAct ? Elysium.actionPrimarySubtle : Elysium.surfaceSubtle)
                                        .foregroundColor(isAct ? Elysium.actionPrimary : Elysium.textSecondary)
                                        .cornerRadius(999)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    // Lecture Cards List (Standard VStack to avoid NSPopover LazyVStack Hang)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(store.filteredLectures) { item in
                                let selected = store.selectedLecture?.id == item.id
                                Button(action: {
                                    Task { await store.selectLecture(id: item.id) }
                                }) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        HStack(spacing: 4) {
                                            Text(item.course)
                                                .font(.system(size: 10.5, weight: .semibold))
                                                .foregroundColor(Elysium.actionPrimary)
                                                .padding(.horizontal, 7)
                                                .padding(.vertical, 2)
                                                .background(Elysium.actionPrimarySubtle)
                                                .cornerRadius(999)
                                            Text((item.is_public ?? false) ? "공개" : "비공개")
                                                .font(.system(size: 10, weight: .semibold))
                                                .foregroundColor((item.is_public ?? false) ? Elysium.statusSuccessFg : Elysium.textTertiary)
                                                .padding(.horizontal, 5)
                                                .padding(.vertical, 1)
                                                .background((item.is_public ?? false) ? Elysium.statusSuccessBg : Elysium.surfaceCanvas)
                                                .cornerRadius(999)
                                            Spacer()
                                            Text(item.date_label)
                                                .font(.system(size: 11, design: .monospaced))
                                                .foregroundColor(Elysium.textTertiary)
                                        }
                                        Text(item.title)
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundColor(Elysium.textPrimary)
                                            .lineLimit(1)
                                        if item.status == "processing" {
                                            Text("\(item.stage_message ?? "분석 중...") (\(item.progress ?? 20)%)")
                                                .font(.system(size: 11.5, weight: .semibold))
                                                .foregroundColor(Elysium.actionPrimary)
                                                .lineLimit(1)
                                        } else {
                                            Text(item.excerpt)
                                                .font(.system(size: 11.5))
                                                .foregroundColor(Elysium.textSecondary)
                                                .lineLimit(2)
                                        }
                                    }
                                    .padding(10)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(selected ? Elysium.actionPrimarySubtle : Elysium.surfaceSubtle)
                                    .cornerRadius(12)
                                }
                                .buttonStyle(.plain)
                                .contextMenu {
                                    Button((item.is_public ?? false) ? "비공개로 전환" : "공유 링크 공개로 전환") {
                                        Task {
                                            await store.selectLecture(id: item.id)
                                            await store.toggleVisibility()
                                        }
                                    }
                                    Button("이 강의 노트 삭제", role: .destructive) {
                                        Task { await store.deleteLecture(id: item.id) }
                                    }
                                }
                            }
                        }
                    }

                    // Account Footer
                    HStack(spacing: 6) {
                        Text(store.currentUserLabel.isEmpty ? "인증됨" : store.currentUserLabel)
                            .font(.system(size: 11))
                            .foregroundColor(Elysium.textSecondary)
                            .lineLimit(1)
                        Spacer()
                        Button("정리") {
                            Task { await store.cleanupShortAndFailedLectures() }
                        }
                        .font(.system(size: 11))
                        Button("새로고침") {
                            Task { await store.fetchLectures() }
                        }
                        .font(.system(size: 11))
                        Button("로그아웃") {
                            store.logout()
                        }
                        .font(.system(size: 11))
                    }
                    .padding(.top, 4)
                }
                .padding(12)
                .frame(width: 290)
                .background(Elysium.surfaceElevated)

                Divider()

                // Right Markdown Reader & Audio Pane (Elysium Surface Canvas #0B0D11)
                VStack(alignment: .leading, spacing: 0) {
                    if let lec = store.selectedLecture {
                        // Toolbar
                        HStack(spacing: 8) {
                            Text(lec.course)
                                .font(.system(size: 11.5, weight: .semibold))
                                .foregroundColor(Elysium.actionPrimary)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Elysium.actionPrimarySubtle)
                                .cornerRadius(999)
                            Text(lec.date_label)
                                .font(.system(size: 11.5, design: .monospaced))
                                .foregroundColor(Elysium.textSecondary)
                            Text(lec.model_used)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(Elysium.textTertiary)

                            Spacer()

                            if lec.status == "error" {
                                Button("원본 재분석") {
                                    Task { await store.retryServerDistillation(id: lec.id) }
                                }
                            }
                            Button((lec.is_public ?? false) ? "공개중" : "비공개") {
                                Task { await store.toggleVisibility() }
                            }
                            Button(store.isEditing ? "취소" : "편집") {
                                if store.isEditing { store.isEditing = false } else { store.beginEditing() }
                            }
                            Button("MD") { store.exportMarkdownFile() }
                            Button("PDF") { store.exportPdfFile() }
                            Button("삭제") {
                                Task { await store.deleteLecture(id: lec.id) }
                            }
                            Button("공유 링크") { store.copyShareLink() }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Elysium.surfaceElevated)

                        Divider()

                        // Audio Player Bar
                        if lec.has_audio {
                            HStack(spacing: 12) {
                                Button(action: { store.toggleAudioPlayback() }) {
                                    Text(store.isPlayingAudio ? "일시정지" : "오디오 재생")
                                        .font(.system(size: 12, weight: .semibold))
                                }
                                Text(String(format: "%02d:%02d", Int(store.currentAudioTime) / 60, Int(store.currentAudioTime) % 60))
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundColor(Elysium.textSecondary)
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
                            .background(Elysium.surfaceSubtle)
                            Divider()
                        }

                        if let banner = store.statusBanner {
                            Text(banner)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(Elysium.actionPrimary)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 6)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Elysium.actionPrimarySubtle)
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
                                    Button("변경사항 저장") {
                                        Task { await store.saveEdits() }
                                    }
                                    .buttonStyle(.borderedProminent)
                                }
                            }
                            .padding(16)
                        } else {
                            ScrollView {
                                NativeMarkdownView(blocks: store.parsedBlocks) { sec in
                                    store.seekAudio(to: sec)
                                }
                                .padding(20)
                            }
                        }
                    } else {
                        VStack {
                            Spacer()
                            Text(store.isLoadingLectures ? "강의 노트를 불러오는 중..." : "왼쪽 목록에서 강의 노트를 선택하거나 새 강의를 녹음하세요.")
                                .foregroundColor(Elysium.textTertiary)
                            Spacer()
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Elysium.surfaceCanvas)
            }
            .frame(width: 940, height: 640)
            .preferredColorScheme(.dark)
        }
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
        statusItem.button?.title = "Lectern"

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
                popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
                NSApp.activate(ignoringOtherApps: true)
                if store.lectures.isEmpty && store.isAuthenticated {
                    Task { await store.fetchLectures() }
                }
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
