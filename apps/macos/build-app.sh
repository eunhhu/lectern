#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
echo "🔨 Building native macOS Menu Bar app (Release)..."
swift build -c release

APP_DIR="Lectern.app/Contents"
mkdir -p "$APP_DIR/MacOS" "$APP_DIR/Resources"
cp ".build/release/LecternMenuBar" "$APP_DIR/MacOS/Lectern"

cat > "$APP_DIR/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Lectern</string>
  <key>CFBundleIdentifier</key>
  <string>com.qucord.lectern.macos</string>
  <key>CFBundleName</key>
  <string>Lectern</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>강의 녹음 및 실시간 요약을 위해 마이크 접근 권한이 필요합니다.</string>
</dict>
</plist>
EOF

echo "✅ Built Lectern.app (macOS Menu Bar agent)"
