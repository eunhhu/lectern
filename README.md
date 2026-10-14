# 📚 Lectern

**Zero-Overhead Cross-Platform Lecture Audio Recorder, Break/Noise Filter & Academic Markdown Distillation Engine**  
Powered by **Bun + TypeScript** & **Gemini Flash (`gemini-flash-latest`)** · Live at **[https://lectern.qucord.com](https://lectern.qucord.com)**

[![Lectern Multi-Platform CI/CD](https://github.com/eunhhu/lectern/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/eunhhu/lectern/actions/workflows/ci-cd.yml)

---

## ⬇️ Native Client Downloads (Built & Verified by GitHub Actions CI/CD)

- ** macOS Menu Bar App (`SwiftUI` + `AppKit` + `⌥Space` Global Hotkey)**: [Lectern-macOS-arm64.zip](https://github.com/eunhhu/lectern/releases/latest/download/Lectern-macOS-arm64.zip)
- **🤖 Android App (`Jetpack Compose` Material3 + Quick Settings Tile)**: [Lectern-android-universal.apk](https://github.com/eunhhu/lectern/releases/latest/download/Lectern-android-universal.apk)
- **🪟 Windows System Tray & Native Dark Reader (`.NET 8 WinForms` + `Alt+Shift+R`)**: [LecternTray-win-x64.exe](https://github.com/eunhhu/lectern/releases/latest/download/LecternTray-win-x64.exe)
- **📱 iOS Shortcut / Action Button Recipe**: [lectern-ios-shortcut.json](https://lectern.qucord.com/api/clients/ios-shortcut)

---

## ✨ Core Architecture & Features

- **⚡ Zero-Overhead Bun + TypeScript Core (`@lectern/core`)**:
  - **Direct Passthrough & Smart HE-AAC Preprocessor**: Compact `.m4a`/`.mp3`/`.webm`/`.ogg` recordings bypass transcoding completely; oversized/uncompressed `.wav` files are converted via `ffmpeg` to 16kHz mono 32kbps HE-AAC.
  - **Chunked Resumable Upload**: Streams 8 MB zero-copy file slices (`Bun.file().slice()`) directly to the Gemini File API with near-zero RAM footprint.
  - **Automatic Break & Forgotten-Recording Filter**: Detects 5–15 min break times (`[쉬는 시간 생략: MM:SS ~ MM:SS]`), post-lecture forgotten recording tails (`[수업 종료 후 녹음 절단: MM:SS ~ 끝]`), and attendance roll calls automatically.
  - **Future-Proof Model Alias**: Defaults to `gemini-flash-latest` (currently resolving to `gemini-3.8-flash`) with `-m / --model` override support.
- **📖 Instant Markdown Reader & Web Recorder (`apps/server`)**:
  - Opens directly into your recorded lectures and structured Markdown notes.
  - **Interactive Timestamp Chips (`⏱ MM:SS`)**: Click any timestamp in the Markdown note to seek the synchronized audio player (`206 Partial Content` range streaming + `1.0x–2.0x` speed control).
  - **Browser Microphone Recording**: Live `MediaRecorder` + 60fps `AudioContext` waveform visualizer + Screen Wake Lock.
  - **A4 Academic PDF Export & Public Share Links (`/s/:token`)**: Print-optimized PDF export and one-click shareable URLs.
- **📱 100% Native Clients Across Every OS (Zero WebView Wrappers)**:
  - **macOS (`apps/macos`)**: Pure SwiftUI + AppKit `NSStatusItem` top menu bar app (`LSUIElement`) with `⌥Space` Carbon global hotkey, real-time dB audio meter, `AVPlayer` timestamp seeking, and native SwiftUI Markdown AST reader.
  - **iOS (`apps/ios`)**: `AppIntents` + iOS Shortcuts / Action Button / Voice Memos Share Sheet one-tap ingest (`/api/ingest/shortcut`).
  - **Android (`apps/android`)**: 100% Native Jetpack Compose Material3 Markdown reader & live `MediaRecorder` bottom sheet + `LecternTileService` Quick Settings Tile for one-tap top-shade recording.
  - **Windows (`apps/windows`)**: Native Dark-Mode .NET 8 WinForms Split-View Markdown Reader + System Tray agent with global hotkey (`Alt+Shift+R`) and WinMM MCI recording.

---

## 🚀 Quick Start & Testing

```bash
# 1. Install dependencies & run strict typecheck + E2E tests
bun install
bun run typecheck
bun test

# 2. Start the Web & API Server (Bun)
bun run start

# 3. Run the CLI directly on any audio file
bun run cli /path/to/lecture.m4a -c "정보보호개론" -m gemini-flash-latest
```

---

## 🔌 One-Tap HTTP Ingest API (Shortcuts / Native Clients)

```bash
curl -X POST https://lectern.qucord.com/api/ingest/shortcut \
  -H "X-Course: 정보보호개론" \
  -F "audio=@20261014_lecture.m4a"
```

## 📄 License

MIT © Sunwoo Moon (`eunhhu`)
