#!/usr/bin/env bash
# Build gate for the v2 build pipeline (docs/v2/pipeline/PIPELINE.md).
# Every work package must pass its gate level before it is merged.
#
#   bash scripts/pipeline/gate.sh quick   install + typecheck
#   bash scripts/pipeline/gate.sh unit    quick + bun test
#   bash scripts/pipeline/gate.sh full    unit + web e2e + preflight (flags off, then flags on)
#
# Nothing here talks to a real provider: tests run in the bunfig sandbox, and the
# preflight boots the server against throwaway directories with every secret blanked.
set -euo pipefail
cd "$(dirname "$0")/../.."

level="${1:-full}"
case "$level" in quick | unit | full) ;; *)
  echo "usage: gate.sh quick|unit|full" >&2
  exit 2
  ;;
esac

step() { printf '\n== gate: %s\n' "$*"; }

step "install (frozen lockfile)"
bun install --frozen-lockfile

step "typecheck"
bun run typecheck
if [ "$level" = quick ]; then
  echo "GATE quick OK"
  exit 0
fi

step "unit tests"
bun test
if [ "$level" = unit ]; then
  echo "GATE unit OK"
  exit 0
fi

step "web e2e (Playwright + axe)"
bun run web:e2e

# The real bun binary: the preflight overrides HOME, which would break a version-manager shim.
BUN_BIN="$(bun -e 'process.stdout.write(process.execPath)')"

# preflight [on]: boots the server like the CD preflight does (apps/server/src/ops.ts runPreflight).
# With "on", every flag listed in docs/v2/pipeline/flags-on.env is set as well.
preflight() {
  local box ok=0
  box="$(mktemp -d)"
  mkdir -p "$box/data" "$box/lectures" "$box/home"
  local -a extra=()
  if [ "${1:-}" = on ] && [ -f docs/v2/pipeline/flags-on.env ]; then
    while IFS= read -r line; do
      case "$line" in '' | '#'*) ;; *) extra+=("$line") ;; esac
    done <docs/v2/pipeline/flags-on.env
  fi
  env LECTERN_PREFLIGHT=1 \
    LECTERN_DATA_DIR="$box/data" LECTERN_LECTURES_DIR="$box/lectures" HOME="$box/home" \
    LECTERN_RESEND_CREDENTIALS_FILE="$box/none.json" LECTERN_LOG_REQUESTS=0 \
    GEMINI_API_KEY= RESEND_API_KEY= LECTERN_DEPLOY_TOKEN= \
    ${extra[@]+"${extra[@]}"} \
    "$BUN_BIN" run apps/server/src/preflight.ts || ok=1
  rm -rf "$box" apps/web/dist.next
  return "$ok"
}

step "preflight (flags off)"
preflight

step "preflight (flags on: docs/v2/pipeline/flags-on.env)"
preflight on

echo "GATE full OK"
