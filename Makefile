.PHONY: help up pull down logs build test lint register install opencode-setup

help:  ## List targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*##/\t/'

up:  ## Build the image and start the server (local build)
	docker compose up -d --build

pull:  ## Pull the prebuilt GHCR image and start the server
	docker compose pull && docker compose up -d

down:  ## Stop and remove the server container
	docker compose down

logs:  ## Follow the server logs
	docker compose logs -f

build:  ## Build the image without starting
	docker compose build

test:  ## Run the engine-free test suite (branch coverage via addopts)
	cd server && uv run pytest

lint:  ## Lint with ruff (ephemeral via uv)
	uv run --with ruff ruff check server evals

register:  ## Register the MCP server with Claude Code (user scope)
	claude mcp add -s user -t sse chess-analysis http://localhost:8000/sse

install:  ## Native (non-Docker) install: stockfish + uv deps
	./install.sh

opencode-setup:  ## Install skills for OpenCode user scope + print MCP registration command
	mkdir -p ~/.config/opencode/skills && cp -r .claude/skills/* ~/.config/opencode/skills/
	@echo ""
	@echo "Skills installed to ~/.config/opencode/skills/ — available in every OpenCode session."
	@echo ""
	@echo "MCP server (pick one):"
	@echo "  In-repo (project config):  opencode.json already registers chess-analysis (SSE at :8000)."
	@echo "                              Run 'docker compose up -d' first, then 'opencode' from this dir."
	@echo "  Any dir (user scope):      Add to ~/.config/opencode/opencode.json:"
	@echo '    {"mcp":{"chess-analysis":{"type":"remote","url":"http://localhost:8000/sse"}}}'
	@echo "  One-line stdio (no daemon):"
	@echo '    {"mcp":{"chess-analysis":{"type":"local","command":["docker","run","-i","--rm","-e","MCP_TRANSPORT=stdio","ghcr.io/azeajr/chess-mcp:latest"]}}}'
