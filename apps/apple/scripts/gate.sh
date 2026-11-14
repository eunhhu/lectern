#!/usr/bin/env bash
# Apple gate: generate the project, test the packages, build both apps without signing.
# Usage: bash apps/apple/scripts/gate.sh
set -euo pipefail
cd "$(dirname "$0")/.."

command -v xcodegen >/dev/null || { echo "gate: xcodegen is not installed (brew install xcodegen)" >&2; exit 2; }

for hook in scripts/pre-gate-*.sh; do   # later work packages add steps here (token sync, OpenAPI copy)
  if [ -f "$hook" ]; then bash "$hook"; fi
done

xcodegen generate --quiet

for pkg in LecternKit RecorderKit LecternUI LecternIntents; do
  echo "gate: swift test $pkg"
  (cd "Packages/$pkg" && swift test)
done

build() {  # scheme, destination
  echo "gate: xcodebuild $1"
  xcodebuild -project Lectern.xcodeproj -scheme "$1" -destination "$2" -configuration Debug \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build -quiet
}
build LecterniOS 'generic/platform=iOS Simulator'
build LecternMac 'generic/platform=macOS'

echo "gate: apple ok"
