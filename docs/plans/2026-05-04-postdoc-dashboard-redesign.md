# Postdoc Dashboard — Comprehensive Redesign Plan

**Date:** 2026-05-04
**Status:** Approved design, not yet implemented
**Owner:** Amir
**Companion:** [`design-research/RESEARCH.md`](../../design-research/RESEARCH.md) — visual references + UI patterns

---

## Vision

Transform the current single-tenant dashboard ("Amir's tracker") into a **self-hosted, AI-augmented postdoc-search workstation** that any academic can install in 60 seconds and use to:

1. Discover relevant professors based on their research interests
2. Auto-research each professor's profile, contact info, and recent work
3. Draft personalized outreach emails grounded in the user's CV and the professor's papers
4. Find matching grants / fellowships / scholarships
5. Maintain and edit their CV, research statement, and other application documents
6. Coordinate reference letters and track formal applications end-to-end

Each user's Claude Code CLI or Codex CLI (already installed and authenticated) powers the AI, so users with a Pro/Max subscription pay nothing for AI on top of the dashboard.

The AI is presented to the user as a single named assistant, **Quill** — the same persona whether the underlying provider is Claude or Codex. Quill is the product surface; the CLI is the substrate.

---

## Non-Goals

To keep scope honest:

- **Not a SaaS.** No accounts, no cloud DB, no shared multi-tenant server. Each user runs their own instance on their own machine.
- **Not an email-sending service.** No Gmail OAuth, no auto-send. The user always reviews and clicks send themselves.
- **Not a portal-uploader.** Different application portals (Workday, Interfolio, university HR) are too varied — we don't try to auto-fill them.
- **Not a mobile app.** Desktop-first, responsive web. Academics work on laptops.
- **Not real-time collab.** Single-user product.
- **Not enterprise auth.** Bind to localhost; optional `--token` flag for LAN exposure.

---

## Stakeholders & Users

| Persona | Description | Skill assumed |
| --- | --- | --- |
| **Primary** | Academic seeking postdoc (PhD candidate, recent PhD, current postdoc looking to switch) | Comfortable installing one CLI tool, copying a one-line install command |
| **Secondary** | Faculty mentor running it on behalf of multiple students (one install per student) | Same |
| **Out of scope** | "Total non-tech grandma" — Docker / install-pipeline considerations don't bend for users who can't install a CLI |

---

## Architecture Overview

### Deployment model

**Self-hosted, single-tenant.** Each user runs an instance on their machine. No login, no accounts.

### Install paths (in priority order)

1. **One-line installer** (Phase 5): `curl -sSL https://postdoc-dashboard.dev/install.sh | sh` → installs uv + Python 3.12 → pulls app to `~/.postdoc-dashboard/` → starts uvicorn on `localhost:3000` → opens browser
2. **Docker compose** (Phase 0): existing `docker-compose up` for power users / Linux server users
3. **Native desktop app** (deferred to post-v1.0): Tauri or PyInstaller-bundled `.dmg` / `.exe`

### Tech stack

| Layer | Today | Proposed | Rationale |
| --- | --- | --- | --- |
| Backend | FastAPI 0.115, SQLAlchemy 2.0, SQLite | **Keep.** Add background-job runner (FastAPI BackgroundTasks → graduate to `arq` if needed for #6 discovery) | Already works; no rewrite needed |
| Frontend | Alpine.js 3.14 + Tailwind CDN | **React 18 + Vite 5 + Tailwind + shadcn/ui + Lucide icons** | Streaming AI panels, file uploads, multiple modals exceed Alpine's sweet spot |
| LaTeX | (none) | **Tectonic** (single Rust binary, downloads packages on demand) | Self-contained CV compilation without requiring a full TeX Live install |
| PDF render | (none) | **pdf.js** (Mozilla) | Client-side PDF preview in CV editor |
| AI gateway | None | **New `dashboard/ai/`** module — subprocess to `claude`/`codex`, SSE stream, Jinja2 prompts | CLI is the contract |
| Storage | SQLite | **Keep SQLite + add `~/.postdoc-dashboard/documents/`** for uploaded PDFs / generated artifacts | SQLite plenty for single-user; raw files belong on disk |
| Auth | None | **Localhost-bind + optional `--token`** | YAGNI for self-hosted |

### Repository structure

```
dashboard/
├── api/                      # FastAPI app (renamed from app/)
│   ├── main.py
│   ├── routes/               # split per-resource (was one big main.py)
│   │   ├── professors.py
│   │   ├── drafts.py
│   │   ├── grants.py
│   │   ├── documents.py
│   │   ├── recommenders.py
│   │   ├── applications.py
│   │   ├── ai.py             # POST /api/ai/run, GET /api/ai/runs/:id/stream
│   │   ├── settings.py
│   │   └── stats.py
│   ├── models.py
│   ├── schemas.py
│   ├── database.py
│   └── seed.py
├── ai/                       # NEW: AI gateway
│   ├── runner.py             # subprocess orchestration, streaming, timeouts
│   ├── providers/
│   │   ├── claude_cli.py
│   │   ├── codex_cli.py
│   │   ├── anthropic_api.py  # fallback
│   │   └── openai_api.py     # fallback
│   ├── prompts/              # Jinja2 templates, versioned
│   │   ├── bootstrap_user_profile.md
│   │   ├── research_professor.md
│   │   ├── extract_profile.md
│   │   ├── draft_email.md
│   │   ├── find_grants.md
│   │   ├── edit_cv.md
│   │   ├── draft_research_statement.md
│   │   ├── discover_professors.md
│   │   └── chat_system.md
│   ├── parsers.py            # JSON-extraction helpers
│   └── tools.py              # web fetch wrappers (Claude WebFetch / Firecrawl)
├── web/                      # NEW: React SPA (replaces app/static/)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── api/
│   │   └── quill/            # Unified Quill chat panel, suggestion chips, run cards
│   ├── public/
│   ├── package.json
│   └── vite.config.ts
├── docs/
│   └── plans/                # this file lives here
├── design-research/          # lazyweb output lives here
├── alembic/                  # NEW: migrations (vs current Base.metadata.create_all)
├── data/                     # SQLite + uploaded documents
├── docker-compose.yml
├── Dockerfile
├── install.sh                # NEW: one-line installer (Phase 5)
└── README.md
```

---

## Data Model

### Existing entities (keep, extend)

- `Professor` — extend with: `scholar_url`, `twitter`, `lab_url`, `last_research_summary`, `research_summary_at`, `auto_filled_at`, `source` (manual | ai_discovered | imported), `is_suggested` (bool), `dismissed_at`
- `EmailDraft` — extend with: `ai_generated` (bool), `ai_run_id` (FK), `version` (int — multiple drafts per prof), `sent_via` (gmail | mailto | copied | other)
- `Activity` — keep as-is
- `Fellowship` → **rename to `Grant`**, extend with: `source` (manual | ai_found), `match_score` (0-100), `matched_reasons`, `region`, `discipline_tags`

### New entities

```text
User (singleton, exactly 1 row)
  id, name, email, current_role, affiliation, country
  research_interests (text), research_categories (json[])
  orcid, scholar_url, github, website, twitter
  phd_year, phd_institution
  created_at, updated_at

Document
  id, kind (cv | research_stmt | teaching_stmt | cover_letter | sample_paper | other)
  title, file_path (relative to data/documents/), text (for non-PDF), extracted_json (for CV)
  is_default (per kind), version (int), created_at, updated_at

Publication
  id, title, venue, year, authors (json[]), my_author_order (int)
  status (published | under_review | in_prep), doi, url
  created_at, updated_at

AIRun
  id, workflow (bootstrap | research_professor | draft_email | find_grants | edit_cv |
    draft_research_statement | discover_professors | extract_profile | chat)
  provider (claude_cli | codex_cli | anthropic_api | openai_api)
  status (queued | running | done | failed | cancelled)
  prompt_hash, prompt_text, output, tokens_in, tokens_out, cost_usd, duration_ms
  professor_id? (FK), document_id? (FK), grant_id? (FK)
  created_at, started_at, completed_at

Settings (singleton)
  ai_provider (claude_cli | codex_cli | anthropic_api | openai_api)
  claude_cli_path, codex_cli_path
  anthropic_api_key (encrypted), openai_api_key (encrypted)
  default_provider_per_workflow (json: workflow → provider)
  email_tone_rules (text — user-editable, defaults from existing memory rules)
  daily_cost_cap_usd
  ui_density (compact | comfortable)

Recommender                  # for reference letters
  id, name, email, relationship, affiliation, notes
  created_at

Application                  # the act of formally applying (vs. outreach)
  id, professor_id (FK), title, deadline, status (planning | submitted | rejected | offer)
  portal_url, notes
  created_at, submitted_at

ApplicationRecommender       # join: which recommenders are on which application
  application_id, recommender_id
  letter_status (asked | agreed | submitted | declined)
  letter_due_date, last_nudge_sent_at, notes

EmailReply                   # capture replies (manual paste or future Gmail thread)
  id, draft_id (FK), thread_url, received_at, content (text)
  classified_sentiment (positive | neutral | negative | unknown)
  resulting_status_change (e.g. "sent → replied")
```

### Migration strategy

- Add Alembic to the project (currently uses `Base.metadata.create_all`)
- Write **one migration `0001_v1_redesign.py`** that:
  1. Creates all new tables
  2. Renames `fellowships` → `grants` and adds new columns
  3. Adds new columns to `professors` and `email_drafts`
  4. Inserts the singleton `User` row populated from the existing hardcoded "Amir" data (so today's install upgrades cleanly)
  5. Inserts the singleton `Settings` row with safe defaults
- Future migrations follow standard Alembic flow

---

## AI Integration Layer

### Module: `dashboard/ai/`

Goal: make CLI calls feel like a first-class feature, not duct tape.

### Execution flow per AI request

```
UI button click
  → POST /api/ai/run  body: {workflow, params, professor_id?, document_id?}
  → backend creates AIRun row (status=queued)
  → enqueue (max 3 concurrent globally, FIFO otherwise)
  → on dequeue: status=running, started_at=now()
  → spawn subprocess:
      claude --print --output-format=stream-json "<rendered Jinja2 prompt>"
    OR
      codex exec --json "<rendered prompt>"
  → stream stdout line-by-line, each event sent to client via SSE
      GET /api/ai/runs/:id/stream
  → final event: parser extracts structured JSON ({email, lab_url, summary, ...})
  → backend writes to relevant DB rows (Professor, EmailDraft, Grant, etc.)
  → AIRun update: status=done, output, tokens, duration_ms, cost_usd
  → frontend updates entity in-place via the parsed payload
```

### Provider selection (per workflow)

1. User's `Settings.default_provider_per_workflow[workflow]` if set
2. Else `Settings.ai_provider` global default
3. If selected provider unavailable (CLI missing, API key absent), fall back per a defined chain: `claude_cli → codex_cli → anthropic_api → openai_api`
4. Surface provider used in the AIRun row and as a small "via claude-cli" / "via codex-cli" tag inside Quill's message metadata — the user always sees Quill, but knows which substrate ran the work

### Guardrails

| Guardrail | Mechanism |
| --- | --- |
| Timeout | 5 min hard cap (configurable in Settings); surfaces "Cancel" button |
| Concurrency | max 3 parallel runs globally; queue overflow |
| Cost visibility | per-run tokens + cumulative-daily total; daily cap from `Settings.daily_cost_cap_usd` |
| Retry on transient failure | one auto-retry with 2s backoff, then surface error to user |
| Prompt versioning | prompts are git-tracked Jinja2 files; SHA stored on AIRun for reproducibility |
| Web fetching | use Claude CLI's WebFetch first (uses subscription); fall back to Firecrawl MCP if available |
| Cancellation | SIGTERM the subprocess; mark AIRun as `cancelled` |

### Prompt template format (Jinja2)

```jinja
{# ai/prompts/research_professor.md #}
You are helping {{ user.name }}, a {{ user.current_role }} at
{{ user.affiliation }}, researching {{ user.research_interests }}.

Task: research Professor {{ professor.name }} at {{ professor.university }}.
{% if professor.profile_url %}
Their profile is at {{ professor.profile_url }}.
{% else %}
You'll need to find their profile via web search.
{% endif %}

Use WebFetch to retrieve their lab page and Google Scholar (if found).
Extract:
- email
- lab URL
- 3-sentence research summary
- top 5 recent papers (title, venue, year)
- whether they're explicitly hiring postdocs

Return JSON: {
  "email": "...",
  "lab_url": "...",
  "summary": "...",
  "recent_papers": [...],
  "hiring_postdocs": true|false|null,
  "confidence": 0-100
}
```

---

## Workflows (8 total)

The contract for every workflow: **(UI trigger) → (Jinja2 prompt) → (CLI run) → (DB write)**. Every tool-call event streams into the right-side **Quill chat panel** as part of the conversation — the user sees Quill narrate "Reading professor's lab page… extracting recent papers… drafting summary…" inline, with status cards for each running workflow.

| # | Workflow | Trigger | Inputs | Outputs |
| --- | --- | --- | --- | --- |
| 0 | `bootstrap_user_profile` | Onboarding wizard "Finish setup" | CV PDF + Scholar URL + personal page URL | Populates `User` row, creates `Publication` rows, creates `Document(kind=cv)` |
| 1 | `research_professor` | "✨ Auto-fill" on professor modal, or bulk "Research selected" | professor name+university OR profile_url | Updates `Professor`: email, lab_url, scholar_url, research_interests, last_research_summary, recent_papers (json), research_category, auto_filled_at |
| 2 | `draft_email` | "✨ Draft email" on professor row/modal | professor (with research summary), user profile, best-matching publication, tone settings | New `EmailDraft` (or new version), `ai_generated=true`, streamed into editor |
| 3 | `find_grants` | "✨ Find matching grants" on Grants page | user profile, filters (region, deadline window) | New `Grant` rows, `source=ai_found`, `match_score`, `matched_reasons`, deduped against existing |
| 4 | `edit_cv` | CV Editor page — Quill chat on right, live PDF preview on left | natural-language instruction | Quill runs `claude -p "<instruction>" --allowed-tools "Read,Edit,Bash" --cwd <cv-dir>`. Multi-step: Read .tex → Edit (one or many) → Bash `tectonic CV.tex` → backend watches FS → pdf.js preview refreshes. **No diff** — preview is the truth. Tool-call events stream into the Quill chat as conversation turns so the user sees each step. |
| 5 | `extract_profile` | "Paste profile URL" quick-add | one URL | New `Professor` row with all extractable fields, default tier=T3, status=drafting |
| 6 | `discover_professors` | "🔍 Find professors" on Discover page | user research_interests + recent papers + filters (region, career stage, tier) | New `Professor` rows with `is_suggested=true`, `match_score`, `matched_reasons`. Background job; streams progress |
| 7 | `draft_research_statement` | "✨ Draft research statement" on Documents page or per-professor | user profile + target professor + existing CV + length target | New `Document(kind=research_stmt)` with structured sections; or replaces an existing draft as a new version |

### Bonus: Reference-letter nudge (variant of #2)

When a recommender's `letter_due_date` is approaching and `last_nudge_sent_at` is more than 7 days ago, a banner on Home offers "Draft polite nudge to Prof X" — which fires `draft_email` with a special `recommender_nudge` template. Same mechanics as workflow #2.

### Quill chat panel (the unified right rail)

The right rail is **one** surface — Quill — not two (no separate "AI Activity drawer" + "chat sidecar"). Cursor's pattern: tool-call activity streams into the same conversation where the user types.

- Always-on right rail, ~400px, collapsible
- Header: sparkles glyph + "Quill" + a "N running" status pill + history/close buttons
- Body is a chat transcript. Three message kinds intermix in one stream:
  1. **User messages** — what the user typed
  2. **Quill messages** — natural-language responses from the assistant
  3. **Workflow status cards** — embedded in the transcript when an inline `✨` button (or Quill itself) launches a workflow. Card shows: workflow title, current step, elapsed time, Cancel button. On completion the card collapses to "Done · 8s · View result"
- **Context-aware** — system prompt declares current page + currently selected entities (current professor, current document, current grant, etc.)
- Read-only access to: User profile, Documents, recently viewed Professors, recent AI Runs
- DB writes only from explicit Accept on suggestion chips or from workflows the user triggered
- Quick-prompt chips below the transcript adapt to the current page ("Find new profs", "What should I do today?", "This week's stats")
- Each message metadata shows: `Quill · via claude-cli · 14:24` so substrate is visible without dominating
- Logged as `AIRun(workflow=chat)` for free-form turns; structured workflows keep their own `AIRun.workflow` value

---

## UI / UX Direction

> Detailed visual references in [`design-research/RESEARCH.md`](../../design-research/RESEARCH.md).

### Design language

- **"Calm tools"** school: Linear, Attio, Notion, Vercel, Cursor — but warmer and more academic
- Light mode only (no dark variant, ever, per user constraint)
- Information density > whitespace
- Single accent color (existing brand blue `#3b6fe0`)
- Dimmed sidebar (`#f5f3ee`) so the bright content area (`#fbfaf7`) pops — Linear's March 2026 refresh principle

### Layout shift

| Today | Proposed |
| --- | --- |
| Top-tab nav with 6 tabs | **Left sidebar nav** with 10 sections |
| Single content column | Sidebar + content + collapsible right rail (Quill chat panel) |
| Modal-only professor edits | Modal kept for MVP; consider full-page record view in Phase 2 (Attio pattern) |

### Page inventory (sidebar order)

1. **Home** — KPIs, follow-ups due, deadlines this week, recent AI activity
2. **Discover** *(new)* — find-professors workflow + suggestions inbox
3. **Professors** — list + Kanban toggle (current "Professors" + "Pipeline" merged)
4. **Drafts** — email drafts (current)
5. **Batches** — ready-to-send (current)
6. **Grants** — grants/fellowships/scholarships (renamed)
7. **Documents** *(new)* — CV, research statement, sample papers, etc.
8. **Calendar** *(new)* — application deadlines + recommender letter due dates + grant deadlines
9. **Activity** — full audit log + AI Runs history (combined)
10. **Settings** *(new)* — profile, AI providers, email rules, recommenders

### AI-specific UI vocabulary

- **Inline `✨` action buttons** on every entity row/modal where Quill helps. Clicking one inserts a workflow status card into the Quill chat panel and runs the workflow there
- **Quill chat panel** (right rail, ~400px) — unified surface combining free-form chat with embedded workflow status cards. Cancellable, queues multiple runs, history view
- **Suggestion chips** — when Quill proposes structured changes, render as Accept/Dismiss inline rather than auto-applying
- **Field-level diff preview** for Quill writes to small fields (professor email, lab URL, etc.) — Accept/Dismiss
- **Live preview, no diff** for CV edits — the rendered PDF is the truth; the chat history shows what was changed in plain language
- **Smart-Compose-style inline suggestions** in the email composer: gray-text continuation, Tab to accept

### Empty states matter

A new install with zero professors has a teaching empty state:

> **No professors yet**
>
> Tell the dashboard what you research and I'll find ~30 professors who match — and pre-fill their contact info.
>
> [✨ Run Discovery] [Add manually] [Import from CSV]

### Component library

- **shadcn/ui** + Tailwind (drop-in to Vite, fully owned)
- **Lucide** for icons (1500+ MIT-licensed stroke icons, native to shadcn ecosystem). **Never use traditional emoji** — replaced with named Lucide icons (`pencil-line`, `send`, `clock`, `message-circle`, `target`, `trophy`, `x-circle`, `search`, `sparkles`, etc.)
- **Inter** font only (locked — Option A from design board). Body 15px (bumped one step from default 14px). **JetBrains Mono** retained for data (IDs, dates, emails, file paths). No display serif.
- No `@radix` lock-in surprises
- TanStack Query for server state, Zustand for local UI state
- **pdf.js** for in-app PDF preview (CV editor)

---

## Build Phasing

7–11 weeks for one engineer. Each phase ends with a demo-able milestone.

### Phase 0 — Foundation rebuild *(1–2 weeks)*

**Goal:** identical features, new substrate. Nothing user-visible new.

- Repo restructure (`api/`, `ai/`, `web/`, `docs/`)
- React + Vite + Tailwind + shadcn/ui scaffold
- Add Alembic; first migration creates new tables + extends existing ones; seeds `User` and `Settings` singletons
- Port the 6 existing screens 1:1 to React; old Alpine UI kept at `/legacy` for rollback safety
- Sidebar nav swap (replaces top tabs)
- React Router setup, layout shell, color tokens

**Ship checkpoint:** existing dashboard fully working under React, identical UX. Old dashboard reachable at `/legacy` for ~1 phase as fallback.

### Phase 1 — Onboarding + first 3 workflows *(2–3 weeks)*

**Goal:** a brand-new user can install, set up, and get a researched professor + drafted email.

- AI gateway module: subprocess runner + SSE stream + per-provider adapters
- Quill chat panel (right rail) — unified chat + embedded workflow status cards. No separate "activity drawer" — one surface only
- First-run wizard (3 steps): welcome → upload CV+Scholar URL+page → review extracted profile
- Workflow #0 `bootstrap_user_profile`
- Workflow #1 `research_professor` + #5 `extract_profile` (quick-add)
- Workflow #2 `draft_email`
- Settings page: AI provider configuration, CLI path detection, email rules editor

**Ship checkpoint:** end-to-end demo — fresh install → onboarding → add a prof from URL → draft an email → mark sent.

### Phase 2 — Discovery + grants *(1–2 weeks)*

**Goal:** a passive user with no professors can be told who to email.

- Workflow #6 `discover_professors` + Suggestions inbox UI
- Background-job runner (FastAPI BackgroundTasks; graduate to `arq` if needed)
- Cancellable long-running runs surfaced as workflow status cards inside the Quill chat panel
- Workflow #3 `find_grants`
- Grants page redesign + matched-grants display + match-score sorting
- Empty-state CTAs that trigger Discovery

**Ship checkpoint:** zero-state install → "find AV profs in Canada" → 30 candidates ranked → user accepts top 5 → emails drafted in one flow.

### Phase 3 — Documents + CV/statements *(1–2 weeks)*

**Goal:** one place for all writing artifacts; AI can edit them.

- Documents page: upload, view, version, default-per-kind
- Workflow #4 `edit_cv`: dedicated CV Editor page with **chat-on-right + live PDF preview on left** (see Appendix D). Bundle Tectonic for LaTeX compilation; pdf.js for in-app preview. Watch the CV directory for file changes, refresh preview when `.pdf` mtime updates.
- Workflow #7 `draft_research_statement` / cover letter (same chat+preview pattern, applied to LaTeX or plain text)
- Per-professor tailored CV variant (link CV ↔ Professor)

**Ship checkpoint:** open CV Editor → type "reorder publications, first-author first" → see Read/Edit/Bash tool calls stream in chat → PDF preview re-renders in <3 seconds.

### Phase 4 — Applications + references *(1 week)*

**Goal:** track real applications, not just outreach.

- `Application` entity: the act of applying, linked to professor + grants used + recommenders
- `Recommender` registry + per-application linkage
- Reference-letter nudge workflow (variant of #2)
- `EmailReply` tracking + status auto-advance
- **Calendar** view (unified: applications + recommender letters + grants)

**Ship checkpoint:** track a real application end-to-end including 3 reference letters, with deadline calendar showing all due dates.

### Phase 5 — Distribution + polish *(1 week)*

**Goal:** any academic can install in 60 seconds.

- One-line installer (`install.sh`) — uv + Python 3.12 + uvicorn launcher
- Final design pass: empty states, transitions, micro-copy
- Comprehensive `README.md` (or docs site)
- v1.0 release on GitHub
- Brief launch post

**Ship checkpoint:** publishable.

---

## Risks & Open Questions

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **Alpine → React migration drift** | Phase 0 takes longer than expected | Keep `/legacy` Alpine UI working; port screen-by-screen; deletion only after sign-off |
| **CLI subprocess streaming unreliability** | AI feels broken or stalls | Ship a thin wrapper with unit tests against recorded fixtures; fall back to API key if CLI consistently fails |
| **Google Scholar blocking aggressive scraping** | `bootstrap_user_profile` and `discover_professors` partially fail | Use Claude WebFetch (subscription, polite UA); fall back to user pasting `.bib` |
| **Long-running discovery exceeds 5 min timeout** | User abandons, partial results lost | Background-job pattern with progress streaming + partial-result persistence |
| **CV LaTeX edits corrupt the source** | User loses formatting | Versioned `.cv-history/` keeps last 5 snapshots; "Restore previous version" button. Claude uses precise Edit tool (string replacement, not full rewrites) which preserves unrelated content. Compile errors surface in chat; one-shot auto-retry asks Claude to fix. |
| **Tectonic not in PATH on user's machine** | CV compilation fails | Bundle Tectonic binary in the install script; fallback to system `pdflatex` if Tectonic unavailable; error in chat directs user to install instructions |
| **Multi-CV install conflict (mentor + 3 students on same machine)** | Data collision | `~/.postdoc-dashboard/<profile-name>/` directory per profile; CLI flag `--profile <name>` |

### Open questions to resolve before Phase 1 starts

1. **Cost-cap default** — what's a sensible default for `Settings.daily_cost_cap_usd` for users on API-key fallback? (Suggest $5/day for first-time users.)
2. **Should Phase 4's calendar integrate with Google Calendar** or remain self-contained? (Suggest self-contained MVP, GCal sync as Phase 6.)
3. **Recommender nudge cadence** — auto-detect "21/14/7 days before deadline" or fully manual? (Suggest auto-suggest, manual confirm.)
4. **Browser extension for "add this professor from any university page"** — Phase 6 candidate or skip entirely?

---

## Out-of-Scope Features (Phase 6+)

Catalogued so we don't lose them, deliberately not built in v1.0:

- Native desktop app (Tauri / PyInstaller `.dmg` / `.exe`)
- Browser extension ("Add this professor from any page")
- Job board ingestion (MathJobs, AcademicJobsOnline, jobRxiv, university HR)
- Co-author graph visualization (intro-path discovery)
- Interview prep mode (auto-questions from prof's last 3 papers)
- Visa / relocation tracker (international postdocs)
- Salary negotiation tracker
- Multi-language support (translate emails into prof's language)
- Public profile / portfolio site export
- Real-time GCal / Outlook calendar sync
- Multi-user mode on a single install (sharing recommenders across students in a lab)

---

## Success Criteria for v1.0

A v1.0 install ships if a brand-new user (assumed: PhD candidate with Claude CLI installed and authenticated) can:

1. Install and launch the dashboard in under 60 seconds
2. Complete onboarding in under 5 minutes (CV upload + Scholar URL + personal page)
3. Run Discovery and accept their first 5 professor suggestions
4. Draft and send (mark-as-sent) their first batch of 5 outreach emails in under 30 minutes
5. Save and edit their CV via the dashboard — type a natural-language instruction in the chat sidebar, watch the PDF preview update live in <3 seconds
6. See their first deadline on the unified Calendar

If all six work end-to-end with no silent failures, v1.0 is shippable.

---

## Appendix A — Reference for visual direction

See [`design-research/RESEARCH.md`](../../design-research/RESEARCH.md) and [`design-research/RESEARCH.html`](../../design-research/RESEARCH.html) for:

- 17 reference screenshots organized by surface
- Six recommended UI patterns with ASCII wireframes
- Eight common patterns + eight anti-patterns
- Six "unique angles to steal" from specific apps

## Appendix B — Memory rules to seed Settings

These existing rules from `MEMORY.md` become the **default** for new installs (user can override in Settings → Email rules):

- Postdoc outreach: 150 to 250 words
- Self-intro by sentence 2 or 3, credential-leading
- No dataset-sharing offers
- Never use em-dashes
- Always spell out IEEE journal names in full
- 2 PhD papers framed as "currently under review at [venue]"
- Montreal driving dataset framed as "large-scale, not yet public"

## Appendix D — CV Editor mechanics (workflow #4)

The user types a natural-language instruction in the right-side chat panel. The backend spawns a single Claude Code (or Codex) subprocess with restricted tools and a fixed working directory:

```bash
claude -p "<user instruction>" \
  --allowed-tools "Read,Edit,Bash" \
  --cwd ~/.postdoc-dashboard/data/documents/cv/ \
  --output-format stream-json \
  --max-turns 8
```

Inside that single invocation Claude autonomously:

1. **Reads** `CV_<user>.tex` (Read tool)
2. **Reasons** about which lines/sections to change (LLM internal)
3. **Edits** the file with precise old/new strings (Edit tool — one or many calls in sequence; uses Edit not Write to preserve unrelated content)
4. **Compiles** by calling `Bash("tectonic CV_<user>.tex")` — Tectonic is a Rust-based portable LaTeX engine, single binary, downloads packages on demand. Output: a fresh `.pdf` next to the source.
5. **Reads** the `.log` to verify success (optional — only if errors)
6. Returns a brief summary of what was changed.

The backend:
- Streams every tool-call event (as JSON over SSE) to the chat panel — user sees `Read CV.tex → Edit CV.tex (lines 78-82) → Bash tectonic CV.tex (2.3s)` exactly as it happens
- Watches the `cv/` directory for `.pdf` mtime changes via inotify (Linux), FSEvents (macOS), or polling fallback
- When the PDF refreshes, sends a "preview-updated" SSE event → frontend reloads the pdf.js viewer on the left

**No diff is ever shown.** The compiled PDF *is* the truth, and the chat history shows what was changed in plain language. If the user dislikes the change they say "undo" or "go back" — Claude reverses via more Edit calls, or the user clicks the "Restore previous version" button (we keep the last 5 versions in `.cv-history/`).

**Codex CLI works analogously** via `codex exec --json` with the same Read/Edit/Bash tool semantics.

**Concurrency safety**: the subprocess runs in a serialized queue *per document* (only one AI run at a time per CV), so the user can't fire two conflicting edits simultaneously. Multiple AI runs across different documents (e.g. CV + research statement) can run concurrently subject to the global 3-run cap.

**Failure modes & recovery**:
- LaTeX compile error → backend reads the `.log`, surfaces the error in the chat, asks Claude to fix (one auto-retry)
- Edit tool can't find the old_string → Claude re-reads and retries with the right context
- Subprocess timeout (5 min) → mark AIRun as `cancelled`, surface "Cancel" button, file remains in last good state (every Edit is committed atomically)

## Appendix C — Decision log

Decisions made during the brainstorming session that should not be reopened without explicit cause:

1. **Self-hosted, not SaaS.** AI integration depends on user's local CLI subscription.
2. **One-line installer is the headline path.** Native desktop app deferred to post-v1.0.
3. **Hybrid AI access** — CLI preferred, API key fallback. Both supported, CLI default.
4. **Hybrid UI** — structured ✨ buttons for known workflows + chat sidecar for free-form.
5. **CV upload + form hybrid** for onboarding (CV-first, form for review/correction, plus arbitrary text/file uploads).
6. **Light mode only.** No dark variant.
7. **Reference letter coordinator** included in MVP (not deferred).
8. **Cover letter / research statement drafter** included as full workflow #7 (not chat-only).
9. **No auto-send / no Gmail OAuth** in MVP. Mark-as-sent + mailto stays.
10. **Sidebar nav** (not top tabs). Information density > whitespace.
11. **Inter only**, body 15px (one step up from 14px). No display serif. JetBrains Mono for data only. (Decided 2026-05-05.)
12. **No traditional emoji.** Lucide icon library used everywhere. (Decided 2026-05-05.)
13. **CV editor: chat-on-right + live PDF preview on left, no diff.** Tectonic for LaTeX compilation. pdf.js for browser preview. Multi-step Claude/Codex tool use (Read → Edit → Bash). (Decided 2026-05-05.)
14. **Tables visually richer:** category-tinted left edge + colored avatar + name/uni stacked + 5-step status journey bar + hover-reveal actions. (Decided 2026-05-05.)
15. **AI is named "Quill"** and presented as a single assistant regardless of underlying CLI. Substrate (claude-cli / codex-cli) shown as small metadata tag, never as the brand. (Decided 2026-05-05.)
16. **Right rail is one unified surface, not two.** Quill chat panel replaces the previously-planned read-only "AI Activity drawer" + separate floating chat sidecar. Tool-call activity from inline `✨` workflows streams into the same conversation as free-form chat (Cursor pattern). (Decided 2026-05-05.)
17. **Surface palette: Higher-contrast warm paper.** Canvas `#fbfaf7`, sidebar/dimmed `#ebe7dc`, deeper `#ddd7c6`, line `#dcd5c2`, line-strong `#c8c0a8`. Sidebar/cards have meaningful separation from canvas (vs the original near-uniform `#f5f3ee` sidebar). Selected from a 5-warm + 3-warm-earth palette explorer. (Decided 2026-05-05.)
