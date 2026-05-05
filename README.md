# Postdoc Application Dashboard

Self-hosted dashboard to track postdoc applications, fellowships, and activity.
Auto-seeds from `../applications.md` on first run (77 professors, 4 fellowships).

## Stack
- **Backend**: FastAPI + SQLAlchemy + SQLite
- **Frontend**: Static HTML + Tailwind (CDN) + Alpine.js (CDN)
- **Persistence**: SQLite file at `./data/postdoc.db`

## Quick start

```bash
cd dashboard
docker compose up -d --build
open http://localhost:8000
```

First run parses `../applications.md` and seeds the DB. On subsequent runs the DB is reused — edits made in the UI persist to `./data/postdoc.db`.

## Re-seed from scratch

```bash
docker compose down
rm -f data/postdoc.db
docker compose up -d
```

## Views

- **Overview** — KPIs, status breakdown, university breakdown, follow-up reminders (>14 days sent, no reply)
- **Pipeline** — Kanban by status (drafting → sent → replied → interview → offer/rejected/no reply)
- **Professors** — filterable/searchable table; click row to edit
- **Fellowships** — card view for IVADO, NSERC, Banting, Concordia Horizon
- **Activity** — append-only log of status transitions, creations, deletions

## API

- `GET  /api/professors?tier=T1&status=sent&university=McGill&q=mila`
- `POST /api/professors` — create
- `PATCH /api/professors/{id}` — update (auto-logs status transitions)
- `DELETE /api/professors/{id}`
- `GET  /api/fellowships`, `POST/PATCH/DELETE` same pattern
- `GET  /api/activity?limit=100`
- `GET  /api/stats` — aggregates
- `GET  /api/export` — full JSON dump
- `GET  /api/health`

## Local dev (without Docker)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
POSTDOC_DB=./data/postdoc.db APPLICATIONS_MD=../applications.md \
  uvicorn app.main:app --reload
```
