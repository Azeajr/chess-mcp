#!/usr/bin/env bash
set -euo pipefail

# Native (non-Docker) install: Stockfish via the system package manager + Python deps via uv,
# to run the server directly with `uv run` (optionally as a systemd --user unit).
# Supports Arch (pacman), Debian/Ubuntu (apt), macOS (brew). Docker users: see README.
#
# Usage:  ./install.sh            # install deps, print the run command
#         ./install.sh --systemd  # also install + reload a systemd --user unit (Linux only)

cd "$(dirname "$0")/server"
REPO_SERVER="$PWD"

# 1. Install Stockfish via whichever package manager is present.
if command -v stockfish &>/dev/null; then
    echo "stockfish: already installed"
elif command -v pacman &>/dev/null; then
    sudo pacman -S --needed --noconfirm stockfish
elif command -v apt-get &>/dev/null; then
    sudo apt-get update && sudo apt-get install -y stockfish
elif command -v brew &>/dev/null; then
    brew install stockfish
else
    echo "No supported package manager (pacman/apt/brew) found." >&2
    echo "Install Stockfish manually, then re-run." >&2
    exit 1
fi

# 2. Resolve the binary path (Arch /usr/bin, Debian /usr/games, brew /opt/homebrew or /usr/local).
STOCKFISH_PATH="$(command -v stockfish || true)"
if [ -z "$STOCKFISH_PATH" ]; then
    for p in /usr/bin/stockfish /usr/games/stockfish /opt/homebrew/bin/stockfish /usr/local/bin/stockfish; do
        [ -x "$p" ] && STOCKFISH_PATH="$p" && break
    done
fi
[ -z "$STOCKFISH_PATH" ] && { echo "stockfish installed but not found on PATH or known paths" >&2; exit 1; }
echo "stockfish: $STOCKFISH_PATH"

# 3. Install uv if missing.
if ! command -v uv &>/dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # shellcheck disable=SC1091
    [ -f "$HOME/.local/bin/env" ] && source "$HOME/.local/bin/env"
fi

# 4. Sync RUNTIME dependencies only (no dev group — pytest etc. are not needed to run the server).
uv sync --no-dev

echo
echo "Install complete."
echo "Run:  STOCKFISH_PATH=$STOCKFISH_PATH uv run chess-mcp   (from $REPO_SERVER)"

# 5. Optional systemd --user unit, generated with the real repo + stockfish paths.
if [ "${1:-}" = "--systemd" ]; then
    if ! command -v systemctl &>/dev/null; then
        echo "systemctl not found (not Linux/systemd) — skipping unit install." >&2
        exit 0
    fi
    unit_dir="$HOME/.config/systemd/user"
    mkdir -p "$unit_dir"
    cat > "$unit_dir/chess-mcp.service" <<EOF
[Unit]
Description=Chess MCP Analysis Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$REPO_SERVER
ExecStart=/usr/bin/env uv run chess-mcp
Restart=on-failure
Environment=FASTMCP_HOST=0.0.0.0
Environment=FASTMCP_PORT=8000
Environment=STOCKFISH_PATH=$STOCKFISH_PATH
Environment=ANALYSIS_DEPTH=18

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    echo "Installed $unit_dir/chess-mcp.service"
    echo "Start at login:  systemctl --user enable --now chess-mcp"
else
    echo "For a background service:  $0 --systemd   (Linux/systemd only)"
fi
