#!/usr/bin/env bash
# run-pass.sh — run an ENGINEERING_PASSES.md pass through claude on a fixed interval.
#
# The pass prompt is extracted live from ENGINEERING_PASSES.md (the ```text block
# under the matching "## ..." heading), so prompt edits take effect on the next run
# without touching this script. Runs claude in YOLO mode
# (--dangerously-skip-permissions): only point it at this repo.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASSES_MD="$REPO_ROOT/ENGINEERING_PASSES.md"
LOG_DIR="$REPO_ROOT/logs/pass-runs"
LOCK_FILE="${TMPDIR:-/tmp}/chess-mcp-run-pass.lock"

INTERVAL="1h"
PASS_NAME="Structural Refactoring"
MODEL="claude-fable-5"
TIMEOUT="30m"
ONCE=0

usage() {
    cat <<EOF
Usage: $(basename "$0") [-i INTERVAL] [-n PASS_NAME] [-m MODEL] [--once]

Runs an ENGINEERING_PASSES.md pass prompt through claude (YOLO mode) on a loop.

  -i INTERVAL   sleep(1) duration between runs (default: 1h; e.g. 30m, 2h, 90m)
  -n PASS_NAME  pass heading to run, case-insensitive substring match
                (default: "Structural Refactoring")
  -m MODEL      claude model (default: claude-fable-5)
  --once        run a single pass and exit (cron-friendly; cron owns the schedule)
  -h, --help    this help

Available passes:
$(grep '^## [0-9]' "$PASSES_MD" | sed 's/^## /  /')

Logs land in logs/pass-runs/ (gitignored). A lock file prevents two loops
running against the repo at once.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -i) INTERVAL="$2"; shift 2 ;;
        -n) PASS_NAME="$2"; shift 2 ;;
        -m) MODEL="$2"; shift 2 ;;
        --once) ONCE=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown argument: $1" >&2; usage >&2; exit 1 ;;
    esac
done

# One loop per repo: a second invocation refuses to start instead of stacking
# concurrent agents on the same working tree.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    echo "error: another run-pass.sh is already running (lock: $LOCK_FILE)" >&2
    exit 1
fi

extract_prompt() {
    awk -v want="$(tr '[:upper:]' '[:lower:]' <<<"$PASS_NAME")" '
        /^## /                     { in_pass = index(tolower($0), want) > 0; next }
        in_pass && $0 == "```text" { capturing = 1; next }
        capturing && $0 == "```"   { exit }
        capturing                  { print }
    ' "$PASSES_MD"
}

run_once() {
    local prompt ts slug log rc
    prompt="$(extract_prompt)"
    if [[ -z "$prompt" ]]; then
        echo "error: no \`\`\`text prompt found under a heading matching '$PASS_NAME'" >&2
        echo "passes available:" >&2
        grep '^## [0-9]' "$PASSES_MD" | sed 's/^## /  /' >&2
        exit 1 # configuration error — die even in loop mode
    fi
    ts="$(date +%Y%m%d-%H%M%S)"
    slug="$(tr '[:upper:] ' '[:lower:]-' <<<"$PASS_NAME" | tr -cd 'a-z0-9-')"
    log="$LOG_DIR/$ts-$slug.log"
    mkdir -p "$LOG_DIR"
    echo "[$ts] running '$PASS_NAME' (model: $MODEL) → $log"
    cd "$REPO_ROOT"
    rc=0
    timeout "$TIMEOUT" claude -p "$prompt" \
        --model "$MODEL" \
        --dangerously-skip-permissions \
        </dev/null 2>&1 | tee "$log" || rc=$?
    if [[ $rc -ne 0 ]]; then
        echo "[$(date +%H:%M:%S)] run failed (rc=$rc) — see $log" >&2
    else
        echo "[$(date +%H:%M:%S)] run finished — $log"
    fi
    return "$rc"
}

trap 'echo "stopping."; exit 0' INT TERM

while :; do
    run_once || true # a failed run must not kill the loop
    ((ONCE)) && break
    echo "sleeping $INTERVAL (next: '$PASS_NAME')"
    sleep "$INTERVAL"
done
