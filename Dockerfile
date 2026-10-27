FROM node:24-bookworm-slim AS site
WORKDIR /app
COPY LICENSE NOTICE.md ./
COPY src/airbnb_price/artifacts ./src/airbnb_price/artifacts
COPY frontend ./frontend
RUN npm --prefix frontend ci --ignore-scripts && npm --prefix frontend run build

FROM python:3.13-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:0.13.4 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock README.md LICENSE NOTICE.md ./
COPY src ./src
COPY scripts ./scripts
COPY --from=site /app/frontend/dist ./frontend/dist
RUN uv sync --frozen --no-dev && uv run --frozen python scripts/package_site.py

FROM python:3.13-slim-bookworm
RUN useradd --create-home --uid 10001 estimator
WORKDIR /app
COPY --from=builder /app/.venv ./.venv
COPY --from=builder /app/src ./src
ENV PATH="/app/.venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1
USER estimator
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=3)"
CMD ["python","-m","uvicorn","airbnb_price.web:app","--host","0.0.0.0","--port","8000"]