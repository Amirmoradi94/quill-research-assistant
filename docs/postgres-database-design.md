# Quill Web App Postgres Database Design

This design converts the current local SQLite desktop schema into a production-ready Postgres schema for the web app. The big change is that every user-owned record is scoped by `account_id`; the current singleton `users` row becomes a per-account academic profile.

## Goals

- Support login, sessions, and future multi-user deployment.
- Keep OpenRouter and model/provider details internal to the backend, not user-facing data.
- Preserve the current product domains: profile, documents, professors, drafts, batches, sent replies, interviews, grants, calendar, and Quill agent runs.
- Make agentic workflows auditable with persisted run events and tool calls.
- Store uploaded file bytes outside Postgres; keep metadata, extracted text, and storage keys in Postgres.
- Use `jsonb` where the data is genuinely flexible, but normalize anything queried, filtered, or joined often.

## Extensions

```sql
create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;
```

Optional later:

```sql
create extension if not exists vector;
```

Use `vector` only if Quill adds semantic document/professor search inside Postgres. Until then, normalized indexes plus `pg_trgm` are enough.

## Naming And Ownership

- Primary keys: `uuid default gen_random_uuid()` for all new web tables.
- Account ownership: every user-owned table gets `account_id uuid not null references accounts(id) on delete cascade`.
- Timestamps: `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.
- Flexible fields: use `jsonb`, not `json`.
- Secrets: store encrypted secrets only, never plaintext API keys or Gmail passwords.

## Core Tables

### `accounts`

Login identity and account lifecycle.

Columns:
- `id uuid primary key`
- `email citext unique not null`
- `password_hash text not null`
- `display_name text`
- `timezone text not null default 'America/Toronto'`
- `status text not null default 'active'`
- `last_login_at timestamptz`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexes:
- `unique (email)`
- partial index for active accounts if needed: `(status) where status = 'active'`

### `sessions`

Server-side login sessions.

Columns:
- `id uuid primary key`
- `account_id uuid not null references accounts(id) on delete cascade`
- `token_hash text unique not null`
- `user_agent text`
- `ip inet`
- `expires_at timestamptz not null`
- `revoked_at timestamptz`
- `created_at timestamptz not null default now()`

Indexes:
- `(account_id, expires_at desc)`
- `(expires_at)` for cleanup

### `account_settings`

Settings that are per account. AI engine config stays backend/internal unless an admin-only control panel is added later.

Columns:
- `account_id uuid primary key references accounts(id) on delete cascade`
- `email_tone_rules text`
- `daily_cost_cap_usd numeric(10,2) not null default 5.00`
- `ui_density text not null default 'comfortable'`
- `batch_defaults jsonb not null default '{}'::jsonb`
- `gmail_address citext`
- `gmail_app_password_encrypted text`
- `gmail_send_name text`
- `gmail_last_verified_at timestamptz`
- `reply_check_enabled boolean not null default false`
- `reply_check_interval_hours integer not null default 4`
- `reply_check_last_run_at timestamptz`
- `reply_check_last_status jsonb`
- `reply_check_last_error text`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:
- `reply_check_interval_hours between 1 and 168`
- `daily_cost_cap_usd >= 0`

## Academic Profile

### `profiles`

Replaces the current singleton `users` table.

Columns:
- `id uuid primary key`
- `account_id uuid unique not null references accounts(id) on delete cascade`
- identity/contact: `name`, `preferred_name`, `pronouns`, `headshot_url`, `email`, `email_secondary`, `phone`, `city`, `country`, `nationality`
- online presence: `orcid`, `scholar_url`, `github`, `linkedin`, `website`, `twitter`
- current role: `current_role`, `affiliation`
- target fields: `target_position_type`, `target_start_date`, `earliest_available_date`, `funding_status`, `commitment_length`
- research fields: `headline`, `research_interests`, `teaching_summary`
- flexible arrays/objects: `languages jsonb`, `target_countries jsonb`, `target_universities_preferred jsonb`, `excluded_institutions jsonb`, `work_authorization jsonb`, `research_categories jsonb`, `methods jsonb`, `application_domains jsonb`, `tools_frameworks jsonb`, `datasets_used jsonb`, `datasets_created jsonb`, `programming_languages jsonb`, `certifications jsonb`, `reviewing_venues jsonb`
- legacy compatibility: `phd_year integer`, `phd_institution text`
- linked docs: `cv_doc_id uuid references documents(id) on delete set null`, `research_statement_doc_id uuid references documents(id) on delete set null`, `transcript_doc_ids jsonb`, `sample_paper_doc_ids jsonb`
- extraction metadata: `field_provenance jsonb`, `cv_last_extracted_at timestamptz`
- timestamps

Indexes:
- `unique (account_id)`
- `gin (research_categories jsonb_path_ops)`
- `gin (methods jsonb_path_ops)`
- `gin (application_domains jsonb_path_ops)`

### Repeatable Profile Sections

These keep the same shape as the current model, but use UUIDs and account ownership:

- `profile_education`
- `profile_publications`
- `profile_experience`
- `profile_awards`
- `profile_references`

Each table should include:
- `id uuid primary key`
- `account_id uuid not null references accounts(id) on delete cascade`
- `profile_id uuid not null references profiles(id) on delete cascade`
- domain columns from the current SQLite model
- `order_idx integer not null default 0`
- timestamps where useful

Indexes:
- `(account_id, profile_id, order_idx)`
- `profile_publications(account_id, year desc)`
- `profile_publications(account_id, is_signature) where is_signature = true`
- `profile_experience(account_id, is_current) where is_current = true`

## Documents

### `documents`

Metadata, storage pointer, extracted text, and extraction JSON.

Columns:
- `id uuid primary key`
- `account_id uuid not null references accounts(id) on delete cascade`
- `kind text not null`
- `title text not null`
- `storage_key text`
- `original_filename text`
- `mime_type text`
- `size_bytes bigint`
- `sha256 text`
- `text text`
- `extracted_json jsonb`
- `is_default boolean not null default false`
- `version integer not null default 1`
- timestamps

Indexes:
- `(account_id, kind)`
- `(account_id, is_default) where is_default = true`
- `unique (account_id, sha256) where sha256 is not null`
- `gin (to_tsvector('english', coalesce(text, '')))` for document search

Storage:
- Local/dev: store files under data directory and write `storage_key`.
- Production: object storage key, for example `accounts/{account_id}/documents/{document_id}/filename.pdf`.

## Professor Discovery And Matching

### `professors`

Target contacts and discovered candidates.

Columns:
- `id uuid primary key`
- `account_id uuid not null references accounts(id) on delete cascade`
- current professor columns: name, university, dept_lab, tier, status, date_sent, email, research_angle, notes, priority, profile_url, research_interests, research_category, scholar_url, twitter, lab_url, last_research_summary, research_summary_at, auto_filled_at, source, is_suggested, dismissed_at, match_score, position_type, prospective_url, hiring_signals jsonb, hiring_notes, hiring_intel jsonb, contact_instructions, profile_scraped_at, relevance_score, relevance_breakdown jsonb, relevance_scored_at
- timestamps

Indexes:
- `(account_id, status)`
- `(account_id, university)`
- `(account_id, research_category)`
- `(account_id, relevance_score desc nulls last)`
- `gin (to_tsvector('english', coalesce(name,'') || ' ' || coalesce(university,'') || ' ' || coalesce(research_interests,'')))`
- `gin (hiring_signals jsonb_path_ops)`

### `professor_papers`

Same as current model, with account ownership.

Indexes:
- `(account_id, professor_id, year desc)`
- `(account_id, relevance_score desc nulls last)`
- `unique (account_id, professor_id, s2_id) where s2_id is not null`

## Outreach

### `email_drafts`

Columns:
- `id uuid primary key`
- `account_id uuid not null references accounts(id) on delete cascade`
- `professor_id uuid not null references professors(id) on delete cascade`
- `subject text not null default ''`
- `body text not null default ''`
- `ai_generated boolean not null default false`
- `ai_run_id uuid references ai_runs(id) on delete set null`
- `version integer not null default 1`
- `sent_via text`
- `sent_at timestamptz`
- `sent_message_id text`
- `send_error text`
- `skipped_at timestamptz`
- `is_backup boolean not null default false`
- `attachment_doc_ids jsonb`
- timestamps

Indexes:
- `(account_id, professor_id)`
- `(account_id, sent_at desc)`
- `(account_id, skipped_at) where skipped_at is not null`
- `unique (account_id, sent_message_id) where sent_message_id is not null`

### `email_replies`

Same as current model, with UUID FKs and account ownership.

Indexes:
- `(account_id, received_at desc)`
- `(account_id, professor_id)`
- `(account_id, draft_id)`
- `unique (account_id, message_id) where message_id is not null`
- `(account_id, meeting_request) where meeting_request = true`
- `(account_id, read_at) where read_at is null`

## Applications, Grants, Calendar

### `applications`

Same as current model, account-scoped.

Indexes:
- `(account_id, status)`
- `(account_id, deadline)`
- `(account_id, professor_id)`

### `recommenders`

Account-scoped recommenders.

Indexes:
- `(account_id, email)`

### `application_recommenders`

Join table:
- `application_id uuid references applications(id) on delete cascade`
- `recommender_id uuid references recommenders(id) on delete cascade`
- primary key `(application_id, recommender_id)`

### `grants`

Same fields as current model, account-scoped.

Indexes:
- `(account_id, status)`
- `(account_id, match_score desc nulls last)`
- `gin (discipline_tags jsonb_path_ops)`

### `calendar_events`

Same fields as current model, account-scoped.

Indexes:
- `(account_id, date)`
- `(account_id, kind, date)`

## Interview Prep

### `interview_prep`

Same as current model, account-scoped.

Indexes:
- `(account_id, professor_id)`
- `(account_id, status)`
- `(account_id, meeting_at)`

### `mock_interviews`

Rename from singular `mock_interview` to plural.

Indexes:
- `(account_id, prep_id)`
- `(account_id, status)`

## Quill Agent Runs

The current `ai_runs` table is useful, but for a web app with agentic workflows we should persist event/tool details separately.

### `ai_runs`

Columns:
- `id uuid primary key`
- `account_id uuid not null references accounts(id) on delete cascade`
- `workflow text not null`
- `status text not null default 'queued'`
- internal engine/provider columns: `engine text`, `model text`
- `prompt_hash text`
- `prompt_text text`
- `request_json jsonb`
- `output text`
- `error_type text`
- `error_message text`
- `tokens_in integer`
- `tokens_out integer`
- `cost_usd numeric(12,6)`
- `duration_ms integer`
- `retry_of_run_id uuid references ai_runs(id) on delete set null`
- optional context FKs: `professor_id`, `document_id`, `grant_id`, `draft_id`
- timestamps: `created_at`, `started_at`, `completed_at`

Indexes:
- `(account_id, created_at desc)`
- `(account_id, workflow, created_at desc)`
- `(account_id, status)`
- `(account_id, error_type) where error_type is not null`
- `(account_id, retry_of_run_id) where retry_of_run_id is not null`

Note: do not show `engine` or `model` in normal user UI. They are operational/internal fields.

### `ai_run_events`

Append-only event stream for reconstructing progress.

Columns:
- `id uuid primary key`
- `account_id uuid not null references accounts(id) on delete cascade`
- `run_id uuid not null references ai_runs(id) on delete cascade`
- `seq integer not null`
- `event_type text not null`
- `message text`
- `payload jsonb`
- `created_at timestamptz not null default now()`

Constraints:
- `unique (run_id, seq)`

Indexes:
- `(account_id, run_id, seq)`
- `(account_id, created_at desc)`

### `ai_tool_calls`

Tool-level audit trail for agentic workflows.

Columns:
- `id uuid primary key`
- `account_id uuid not null references accounts(id) on delete cascade`
- `run_id uuid not null references ai_runs(id) on delete cascade`
- `tool_name text not null`
- `input jsonb`
- `output jsonb`
- `status text not null default 'running'`
- `error text`
- `started_at timestamptz not null default now()`
- `completed_at timestamptz`

Indexes:
- `(account_id, run_id, started_at)`
- `(account_id, tool_name, started_at desc)`
- `(account_id, status)`

## Activity

### `activities`

Same as current model, account-scoped. It remains a product-visible audit log, separate from low-level `ai_run_events`.

Indexes:
- `(account_id, created_at desc)`
- `(account_id, professor_id, created_at desc)`

## Auth And Security Notes

- Password hashes should use Argon2id.
- Session cookies should be `HttpOnly`, `SameSite=Lax`, secure in production.
- Encrypt Gmail passwords and any backend-managed secrets with application-level encryption.
- Keep AI provider keys in server environment or an admin-only encrypted table, not in user-facing settings.
- Add Postgres row-level security later if direct multi-tenant DB access is introduced. The first version can enforce ownership in API queries.

## Migration From Current SQLite

1. Add Postgres dependency and config:
   - `DATABASE_URL=postgresql+psycopg://...`
   - Keep SQLite fallback for local desktop mode if needed.
2. Introduce Alembic migrations. Stop relying on `Base.metadata.create_all()` for production.
3. Create `accounts` and one account for the current user.
4. Copy singleton `users` to `profiles` with `account_id`.
5. Copy `settings` to `account_settings`, omitting user-facing provider setup fields from UI.
6. Copy documents metadata and move files to the chosen storage layout.
7. Copy all domain tables with generated UUIDs and maintain an ID mapping table during migration.
8. Convert JSON to `jsonb`.
9. Replace integer FK references with mapped UUID references.
10. Validate counts per table, then run app smoke tests.

Recommended temporary mapping table during migration:

```sql
create table migration_id_map (
  table_name text not null,
  old_id integer not null,
  new_id uuid not null,
  primary key (table_name, old_id)
);
```

## First Implementation Milestone

Milestone 1 should not attempt to perfect every table. It should:

1. Add Postgres connection support.
2. Add Alembic.
3. Create `accounts`, `sessions`, `profiles`, `account_settings`.
4. Convert core tables to account-scoped UUID tables.
5. Keep API behavior unchanged from the UI perspective.
6. Add a migration script from SQLite to Postgres.

After that, add `ai_run_events` and `ai_tool_calls` so Quill’s agentic workflows are durable and inspectable.
