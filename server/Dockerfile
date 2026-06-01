FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        stockfish \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml .
RUN uv sync --no-dev

COPY chess_mcp.py .

ENV STOCKFISH_PATH=/usr/bin/stockfish \
    FASTMCP_HOST=0.0.0.0 \
    FASTMCP_PORT=8000

EXPOSE 8000

CMD ["uv", "run", "python", "chess_mcp.py"]
