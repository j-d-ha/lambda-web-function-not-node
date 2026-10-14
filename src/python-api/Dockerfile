# syntax=docker/dockerfile:1

# Builds the Python backend's zip on linux/arm64. Interpreter, locked
# dependencies, tests and packaging all run on the target architecture inside
# the container, so nothing needs cross-platform resolution on the host and the
# only thing exported is the finished zip.
FROM ghcr.io/astral-sh/uv:0.13.1-debian AS build

# uv is the only thing that fetches Python: it installs the managed interpreter
# named in .python-version into a stable prefix so the tree can be shipped.
# UV_COMPILE_BYTECODE precompiles the dependencies, which Lambda cannot do
# itself (its /var/task is read-only). PYTHONDONTWRITEBYTECODE keeps the build's
# own test run from leaving stdlib .pyc in the tree it then packages.
ENV UV_PYTHON_INSTALL_DIR=/uv-python \
    UV_PYTHON_PREFERENCE=only-managed \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl zip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Layer 1: interpreter and dependencies. Re-runs only when the manifest, the
# lock or the version pin changes -- this layer is the build cache.
COPY src/python-api/pyproject.toml src/python-api/uv.lock src/python-api/.python-version ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

# Layer 2: application code, which changes on almost every build.
COPY src/python-api/main.py src/python-api/test_main.py src/python-api/smoke.sh ./
COPY src/node-wrapper/index.js ./index.js
RUN uv run python -m unittest

# Layer 3: trim the interpreter, lay the bundle out the way Lambda does
# (/var/task), prove it boots, then zip it. The interpreter path is derived, so
# .python-version stays the only place the Python version is written down.
RUN set -eux; \
    PY=$(readlink -f "$(uv python find)"); \
    MINOR=$(basename "$PY" | sed 's/^python//'); \
    PREFIX=$(dirname "$(dirname "$PY")"); \
    # Drop what an HTTP server never loads. Two traps make this worth spelling
    # out. bin/python and bin/python3 are symlinks to python3.13, and zip
    # dereferences symlinks unless given -y, so leaving them in stores the
    # interpreter three times -- 44 MB of waste. And libpython3.13.so* ships
    # even though the interpreter links only libc/libm/librt, another 44 MB.
    # Globs, not exact filenames, so a tcl or libpython version bump cannot
    # quietly leave half of it behind.
    find "$PREFIX/bin" -mindepth 1 ! -name "python$MINOR" -delete; \
    rm -rf "$PREFIX/BUILD" "$PREFIX/include" "$PREFIX/share" "$PREFIX"/lib/pkgconfig; \
    rm -rf "$PREFIX"/lib/tcl* "$PREFIX"/lib/tk* "$PREFIX"/lib/itcl* "$PREFIX"/lib/thread*; \
    rm -f "$PREFIX"/lib/libtcl* "$PREFIX"/lib/libtk* "$PREFIX"/lib/libpython*; \
    rm -rf "$PREFIX/lib/python$MINOR/tkinter" "$PREFIX/lib/python$MINOR/idlelib" \
           "$PREFIX/lib/python$MINOR/ensurepip" "$PREFIX/lib/python$MINOR/config-$MINOR"*; \
    rm -rf "$PREFIX/lib/python$MINOR/site-packages/pip"*; \
    mkdir -p /var/task; \
    cp -R "$PREFIX" /var/task/python; \
    cp -R ".venv/lib/python$MINOR/site-packages/." "/var/task/python/lib/python$MINOR/site-packages/"; \
    { printf '#!/var/task/python/bin/python%s\n' "$MINOR"; cat main.py; } > /var/task/server; \
    chmod +x /var/task/server "/var/task/python/bin/python$MINOR"; \
    cp index.js /var/task/index.js; \
    /app/smoke.sh /var/task; \
    cd /var/task && zip -qr /python-api.zip .

# The zip is the only artifact; --output type=local copies it straight out.
FROM scratch AS export
COPY --from=build /python-api.zip /
