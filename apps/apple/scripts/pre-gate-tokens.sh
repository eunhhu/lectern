#!/usr/bin/env bash
# The design tokens come from packages/design-tokens (`bun run tokens:build`). LecternUI keeps a
# committed copy because SwiftPM cannot read files outside the package. The gate only checks that
# the copy is current; it does not copy (a silent difference is what this stops).
set -euo pipefail
cd "$(dirname "$0")/.."
source=../../packages/design-tokens/dist/Tokens.swift
copy=Packages/LecternUI/Sources/LecternUI/Tokens/Tokens.swift
if ! cmp -s "$source" "$copy"; then
  echo "gate: Tokens.swift is out of date (run: cp packages/design-tokens/dist/Tokens.swift apps/apple/Packages/LecternUI/Sources/LecternUI/Tokens/)" >&2
  exit 1
fi
