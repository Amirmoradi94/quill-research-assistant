FROM node:22-bookworm-slim AS web-build

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web ./
ARG VITE_API_BASE=
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build


FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    POSTDOC_DB=/app/data/postdoc.db \
    APPLICATIONS_MD=/app/seed/applications.md \
    POSTDOC_STATIC_DIR=/app/static \
    POSTDOC_DISABLE_REPLY_POLLER=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app
COPY ai ./ai
COPY alembic ./alembic
COPY alembic.ini ./
COPY --from=web-build /build/web/dist ./static
RUN test -f ./static/index.html

RUN mkdir -p /app/data /app/seed

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/api/health').status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
