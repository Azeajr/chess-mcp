FROM ghcr.io/astral-sh/uv:python3.14-trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        stockfish \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
RUN uv sync --no-dev --no-install-project

COPY chess_mcp.py .

ENV STOCKFISH_PATH=/usr/games/stockfish \
    FASTMCP_HOST=0.0.0.0 \
    FASTMCP_PORT=8000

EXPOSE 8000

CMD ["uv", "run", "python", "chess_mcp.py"]
