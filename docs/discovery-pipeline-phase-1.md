# Discovery Pipeline Phase 1

Phase 1 creates the durable data layer for deterministic professor discovery. It does not crawl the web yet; later phases will write into these tables.

## Goals

- Track every exhaustive discovery run from queue to completion.
- Store university, department, page, candidate, evidence, and log records separately.
- Preserve enough status/error metadata to audit coverage gaps.
- Keep the current prompt-based Discover workflow working while the deterministic crawler is built.

## Tables

- `discovery_runs`: one crawl pass with target filters, phase, status, counters, timings, and errors.
- `discovery_universities`: target-country university records with official domains and source confidence.
- `discovery_departments`: relevant departments, schools, institutes, labs, or research groups found per university.
- `discovery_pages`: crawlable URLs with page type, fetch status, content hash, and extraction counts.
- `discovery_candidates`: professor candidates extracted from pages before/after verification and scoring.
- `discovery_evidence`: evidence snippets or URLs supporting a candidate, contact field, country, rank, or rejection.
- `discovery_logs`: append-only run logs for progress, failures, and audit trails.

## API

- `GET /api/discovery/coverage`
  - Returns active/latest run.
  - Returns aggregate counts across discovery tables.
  - Returns recent discovery logs.

## Next Phase Contract

Phase 2 should create a `discovery_runs` row, populate `discovery_universities`, and update run counters/logs as universities are enumerated from structured sources.
