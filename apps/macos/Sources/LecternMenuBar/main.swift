import AppKit
import AVFoundation
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, AVAudioRecorderDelegate {
    private var statusItem: NSStatusItem!
    private var popover: NSPopover!
    private var webView: WKWebView!
    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var startTime: Date?
    private var currentFileURL: URL?

    private let serverBase = ProcessInfo.processInfo.environment["LECTERN_URL"] ?? "https://lectern.qucord.com"
    private var selectedCourse: String = UserDefaults.standard.string(forKey: "lectern_course") ?? "정보보호개론"

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        updateStatusBarTitle(recording: false, elapsed: 0)

        if let button = statusItem.button {
            button.target = self
            button.action = #selector(handleStatusBarClick(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 880, height: 640), configuration: config)
        if let url = URL(string: serverBase) {
            webView.load(URLRequest(url: url))
        }

        let vc = NSViewController()
        vc.view = webView

        popover = NSPopover()
        popover.contentSize = NSSize(width: 880, height: 640)
        popover.behavior = .transient
        popover.contentViewController = vc
    }

    @objc private func handleStatusBarClick(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else { return }
        if event.type == .rightMouseUp || event.modifierFlags.contains(.option) {
            showContextMenu()
        } else {
            togglePopover(sender)
        }
    }

    private func togglePopover(_ sender: AnyObject?) {
        if popover.isShown {
            popover.performClose(sender)
        } else if let button = statusItem.button {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func showContextMenu() {
        let menu = NSMenu()
        let isRec = recorder?.isRecording ?? false

        let recTitle = isRec ? "⏹ 녹음 종료 및 노트 증류 업로드" : "🔴 즉시 강의 녹음 시작 (\(selectedCourse))"
        let recItem = NSMenuItem(title: recTitle, action: #selector(toggleRecording), keyEquivalent: "r")
        recItem.target = self
        menu.addItem(recItem)

        let openReaderItem = NSMenuItem(title: "📖 마크다운 리더 열기", action: #selector(openReaderPopover), keyEquivalent: "o")
        openReaderItem.target = self
        menu.addItem(openReaderItem)

        menu.addItem(NSMenuItem.separator())

        let courses = ["정보보호개론", "자바프로그래밍", "영어읽기와토론", "대순사상과상생윤리"]
        for c in courses {
            let item = NSMenuItem(title: "과목: \(c)", action: #selector(selectCourse(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = c
            item.state = (c == selectedCourse) ? .on : .off
            menu.addItem(item)
        }

        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Lectern 종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    @objc private func openReaderPopover() {
        togglePopover(statusItem.button)
    }

    @objc private func selectCourse(_ sender: NSMenuItem) {
        if let c = sender.representedObject as? String {
            selectedCourse = c
            UserDefaults.standard.set(c, forKey: "lectern_course")
        }
    }

    @objc private func toggleRecording() {
        if let rec = recorder, rec.isRecording {
            stopAndUploadRecording()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        let tmpDir = FileManager.default.temporaryDirectory
        let fileURL = tmpDir.appendingPathComponent("lectern_\(Int(Date().timeIntervalSince1970)).m4a")
        currentFileURL = fileURL

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32000,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        do {
            recorder = try AVAudioRecorder(url: fileURL, settings: settings)
            recorder?.delegate = self
            recorder?.record()
            startTime = Date()
            updateStatusBarTitle(recording: true, elapsed: 0)

            timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
                guard let self = self, let st = self.startTime else { return }
                self.updateStatusBarTitle(recording: true, elapsed: Int(Date().timeIntervalSince(st)))
            }
        } catch {
            NSLog("Lectern recording error: \(error)")
        }
    }

    private func stopAndUploadRecording() {
        recorder?.stop()
        recorder = nil
        timer?.invalidate()
        timer = nil
        updateStatusBarTitle(recording: false, elapsed: 0, uploading: true)

        guard let fileURL = currentFileURL else { return }
        uploadAudioFile(fileURL: fileURL, course: selectedCourse)
    }

    private func updateStatusBarTitle(recording: Bool, elapsed: Int, uploading: Bool = false) {
        DispatchQueue.main.async {
            if uploading {
                self.statusItem.button?.title = "⚡ 증류 중..."
            } else if recording {
                let m = String(format: "%02d", elapsed / 60)
                let s = String(format: "%02d", elapsed % 60)
                self.statusItem.button?.title = "🔴 \(m):\(s)"
            } else {
                self.statusItem.button?.title = "📚 Lectern"
            }
        }
    }

    private func uploadAudioFile(fileURL: URL, course: String) {
        guard let endpoint = URL(string: "\(serverBase)/api/ingest/shortcut?wait=false"),
              let audioData = try? Data(contentsOf: fileURL) else {
            updateStatusBarTitle(recording: false, elapsed: 0)
            return
        }

        let boundary = "Boundary-\(UUID().uuidString)"
        var req = URLRequest(url: endpoint)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue("macos-menubar", forHTTPHeaderField: "X-Client")

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

        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let self = self else { return }
            try? FileManager.default.removeItem(at: fileURL)
            self.updateStatusBarTitle(recording: false, elapsed: 0)

            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let urlStr = json["url"] as? String,
                  let targetURL = URL(string: urlStr) else { return }

            DispatchQueue.main.async {
                self.webView.load(URLRequest(url: targetURL))
                if let btn = self.statusItem.button, !self.popover.isShown {
                    self.popover.show(relativeTo: btn.bounds, of: btn, preferredEdge: .minY)
                    NSApp.activate(ignoringOtherApps: true)
                }
            }
        }.resume()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
