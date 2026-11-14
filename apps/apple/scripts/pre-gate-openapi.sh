#!/usr/bin/env bash
# Writes the API v2 description into LecternKit, where swift-openapi-generator reads it at build
# time (P6-A2, D-P6-7). openapi-for-swift.py turns zod's nullable references into optional
# properties, which the generator otherwise drops. The output is not committed; it is rewritten
# only when it changed.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/openapi-for-swift.py ../../packages/domain/openapi.json Packages/LecternKit/Sources/LecternKit/openapi.json
