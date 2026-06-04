.PHONY: help up pull down logs build test lint register install sync-skills

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

sync-skills:  ## Mirror canonical plugin/skills -> .claude/skills (run after editing skills)
	rm -rf .claude/skills && cp -r plugin/skills .claude/skills
