#!/usr/bin/env bash
set -e

# Install stockfish and uv
sudo pacman -S --needed stockfish

# Install uv if not present
if ! command -v uv &>/dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    source "$HOME/.local/bin/env"
fi

# Sync dependencies
cd "$(dirname "$0")/server"
uv sync

echo "Install complete."
echo "Run:  uv run chess_mcp.py"
echo "Or:   systemctl --user enable --now chess-mcp"
