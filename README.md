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

---

## 🛠 Operations

The admin console at `/admin` (owner/admin accounts) shows jobs, storage, members, audit log and policy, and runs the actions below. Shortcuts: `⌘K` command palette, `G` then a letter to switch views, `?` for the full list.

**Jobs.** Distillations run in a bounded in-process queue, with one job per lecture. Only transient Gemini failures (network, timeout, 429, 5xx) are retried. Lectures interrupted by a restart are re-queued on boot.

**Storage.**
- Once a lecture finishes, its uploaded audio is re-encoded to mono AAC (`.m4a`, 40 kbps by default, about 18 MB per hour). The new file is kept only if it is at least 15% smaller and has the same duration.
- The `_원본` copy in the lecture archive is a hard link and stays lossless.
- Upload files that no lecture references are moved to `DATA_DIR/trash` and deleted after 7 days.
- Retention policies are off by default. When enabled:
  - the audio of old finished lectures is removed and their notes are kept;
  - failed lectures that have sat unchanged past the limit are deleted.

**Maintenance** runs hourly. It:
- purges expired sessions and verification codes;
- prunes audit logs older than 180 days by default;
- moves orphaned uploads to the trash, and empties old trash and temp files;
- applies the retention policies;
- writes a daily `VACUUM INTO` backup to `DATA_DIR/backups` (the newest 7 are kept);
- checkpoints the WAL.

Backups sit on the same disk as the database, so copy them off the host for disaster recovery.

**Deploys and shutdown.** `POST /api/cd/deploy` runs `git fetch`, `git reset --hard origin/main` and `bun install --frozen-lockfile` in `LECTERN_REPO_DIR`. It then shuts down gracefully, and the process supervisor restarts it. On SIGTERM, the server waits up to `LECTERN_SHUTDOWN_GRACE_SEC` for running jobs and then exits. For systemd, use `Restart=always` and `TimeoutStopSec=` larger than the grace period.

| Variable | Default | Purpose |
| --- | --- | --- |
| `LECTERN_REPO_DIR` | legacy prod path if present | Checkout the CD webhook updates; deploys are refused without one |
| `LECTERN_MAX_CONCURRENT_JOBS` | `2` | Concurrent Gemini distillations |
| `LECTERN_MAX_CONCURRENT_COMPACT` | `1` | Concurrent ffmpeg compactions |
| `LECTERN_GEMINI_TIMEOUT_MS` | `900000` | Deadline for one `generateContent` call |
| `LECTERN_MAINTENANCE_INTERVAL_MIN` | `60` | Maintenance cadence |
| `LECTERN_BACKUP_INTERVAL_HOURS` / `LECTERN_BACKUP_KEEP` | `24` / `7` | Backup frequency and rotation |
| `LECTERN_TRASH_DAYS` | `7` | Days before trashed uploads are deleted |
| `LECTERN_SHUTDOWN_GRACE_SEC` | `20` | Time running jobs get on shutdown or deploy |
| `LECTERN_LOG_REQUESTS` | on | Set `0` to silence the request log (tokens are redacted) |

`GET /api/health` reports `checks.database` and `checks.disk`, and answers `503` when the database is unreachable.

## 📄 License

MIT © Sunwoo Moon (`eunhhu`)
