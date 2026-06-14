FROM ghcr.io/astral-sh/uv:python3.14-trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        stockfish \
    && rm -rf /var/lib/apt/lists/*

# Optional: uncomment to enable Maia/Leela backends (adds ~200MB to image)
# RUN apt-get update && apt-get install -y --no-install-recommends \
#         lc0 \
#     && rm -rf /var/lib/apt/lists/* \
#     && mkdir -p /usr/share/chess/maia-weights
#
# # Download Maia weights (9 ratings: 1100-1900 in 100-point increments)
# RUN cd /usr/share/chess/maia-weights && \
#     for rating in 1100 1200 1300 1400 1500 1600 1700 1800 1900; do \
#       wget "https://maiachess.com/maia/Maia_$rating.pb.gz" -O "maia-$rating.pb.gz" || true; \
#     done

WORKDIR /app

COPY pyproject.toml .
RUN uv sync --no-dev --no-install-project

COPY chess_mcp.py structure.py repertoire.py openings.py openings.tsv apiclient.py evalcache.py boardwidget.py ./

ENV STOCKFISH_PATH=/usr/games/stockfish \
    FASTMCP_HOST=0.0.0.0 \
    FASTMCP_PORT=8000

EXPOSE 8000

CMD ["uv", "run", "python", "chess_mcp.py"]
