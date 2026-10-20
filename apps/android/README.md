# Lectern Android

Jetpack Compose reader, in-app recorder and Quick Settings tile for Lectern.

## Build

Requires JDK 17 and the Android SDK (platform 34). Use the Gradle wrapper (Gradle 8.7), not a system Gradle:

```bash
cd apps/android
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
```

Point the SDK at Gradle with `ANDROID_HOME` or a git-ignored `local.properties` (`sdk.dir=...`).

The server is fixed at build time. It is never read from an intent, because `MainActivity` is exported and any app could otherwise redirect the token or login password. To build against another server:

```bash
./gradlew assembleDebug -Plectern.serverUrl=https://staging.example.com
```

## Release signing

`assembleRelease` signs with a release key taken from these environment variables:

| Variable | Meaning |
| --- | --- |
| `LECTERN_KEYSTORE_FILE` | Path to the keystore (`.jks` / PKCS12) |
| `LECTERN_KEYSTORE_PASSWORD` | Keystore password |
| `LECTERN_KEY_ALIAS` | Key alias |
| `LECTERN_KEY_PASSWORD` | Key password (optional, defaults to the keystore password) |

Without `LECTERN_KEYSTORE_FILE`, the release APK falls back to the machine's debug key and Gradle prints a warning. Each CI runner generates a fresh debug key, so such APKs will not install as updates over each other.

`versionCode` comes from `GITHUB_RUN_NUMBER` on CI (1 locally), so every published APK is a valid upgrade.

### GitHub Actions secrets

The `android-native` job in `.github/workflows/ci-cd.yml` reads these repository secrets:

| Secret | Value |
| --- | --- |
| `LECTERN_ANDROID_KEYSTORE_BASE64` | `base64` of the keystore file |
| `LECTERN_ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `LECTERN_ANDROID_KEY_ALIAS` | Key alias |
| `LECTERN_ANDROID_KEY_PASSWORD` | Key password (may be omitted for PKCS12 keystores) |

If `LECTERN_ANDROID_KEYSTORE_BASE64` is missing (for example on pull requests from forks), the job still builds a debug-signed APK and reports a warning annotation.

To create the key once and keep it somewhere safe outside the repository:

```bash
keytool -genkeypair -keystore lectern-release.jks -alias lectern -keyalg RSA -keysize 4096 -validity 10000
```

```bash
base64 -i lectern-release.jks | pbcopy
```

Paste the clipboard into `LECTERN_ANDROID_KEYSTORE_BASE64`. If the key is lost, installed copies can no longer be updated. Devices that have the earlier debug-signed APK must uninstall it once before installing the first release-signed build.

## Recording and uploads

- Recording runs in `RecordingService`, a foreground service of type `microphone`, so it keeps going with the screen locked. The app and the tile both use it.
- The tile starts recording through `QuickRecordActivity`, a non-exported, invisible activity. A microphone foreground service only gets microphone access when it is started while one of the app's activities is visible.
- Finished recordings are stored in `Android/data/com.qucord.lectern/files/LecternRecordings/` and listed in a persistent pending-upload queue. `UploadWorker` (WorkManager) uploads them to `POST /api/ingest/shortcut?wait=false` with `X-Lectern-Token` and a per-recording `X-Idempotency-Key`. A recording leaves the queue only after the server confirms it.
- Network errors, 408, 429 and 5xx responses are retried with backoff. Other 4xx responses are not retried, and the recording stays in the queue. On a 401 the stored token is cleared and the login screen is shown. The app shows a banner for queued or failed uploads, with per-item retry and delete.
- Recordings made in the app keep their local original after upload. Tile recordings are deleted once the server accepts them.
