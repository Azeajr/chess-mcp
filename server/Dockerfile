FROM ghcr.io/astral-sh/uv:python3.14-trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        stockfish \
    && rm -rf /var/lib/apt/lists/*

# Optional: uncomment to enable the Maia/Leela backends of engine_move (lc0). lc0 is NOT
# packaged in Debian trixie, so it is built from source with the CPU (eigen) backend. This
# adds the build toolchain + the lc0 binary to the image (~hundreds of MB); for a lean image,
# move this to a multi-stage build and copy only /usr/local/bin/lc0 into the final stage.
# RUN apt-get update && apt-get install -y --no-install-recommends \
#         git build-essential meson ninja-build pkg-config zlib1g-dev libeigen3-dev wget ca-certificates \
#     && git clone --depth 1 --recurse-submodules https://github.com/LeelaChessZero/lc0 /tmp/lc0 \
#     && (cd /tmp/lc0 && meson setup build --buildtype=release -Dgtest=false && ninja -C build) \
#     && cp /tmp/lc0/build/lc0 /usr/local/bin/lc0 && rm -rf /tmp/lc0 /var/lib/apt/lists/* \
#     && mkdir -p /usr/share/chess/maia-weights
# ENV LC0_PATH=/usr/local/bin/lc0
#
# # Maia weights (ratings 1100-1900) from the canonical CSSLab/maia-chess repo. The files are
# # already named maia-<rating>.pb.gz — exactly what engine_move's _get_engine_path looks for.
# RUN cd /usr/share/chess/maia-weights && \
#     for r in 1100 1200 1300 1400 1500 1600 1700 1800 1900; do \
#       wget -q "https://raw.githubusercontent.com/CSSLab/maia-chess/master/maia_weights/maia-$r.pb.gz"; \
#     done

WORKDIR /app

# Install runtime deps first (cached unless pyproject changes), then the package itself.
COPY pyproject.toml ./
RUN uv sync --no-dev --no-install-project

COPY src ./src
RUN uv sync --no-dev

ENV STOCKFISH_PATH=/usr/games/stockfish \
    FASTMCP_HOST=0.0.0.0 \
    FASTMCP_PORT=8000

EXPOSE 8000

CMD ["uv", "run", "chess-mcp"]
