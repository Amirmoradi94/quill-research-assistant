# Interview Prep Feature — Implementation Plan

Date: 2026-05-15
Status: Proposed

## Goal

When a professor replies wanting a meeting, help the user get ready. Generate
tailored prep materials and run an AI mock interview. Position-type aware
(Master / PhD / Postdoc), since the dashboard is universal for any research
position search.

## Scope (v1)

In: meeting detection nudge, professor/lab briefing, fit analysis, talking
points, question bank with editable answer drafts, questions-to-ask, logistics
checklist, AI mock-interview mode, post-interview thank-you helper.

Out (later): job-talk / research-presentation builder, panel per-person
briefings.

## Decisions

- Mock interview mode ships in v1.
- New dedicated page `/interview-prep` (list of all upcoming interviews +
  detail view), per user choice.
- Prep is professor-scoped, stored, editable over days. One `InterviewPrep`
  row per professor (regenerating overwrites/versions it).
- Mock interview reuses the existing single-shot runner — each turn is one
  runner call carrying the full transcript. No long-lived process needed.
- Meeting detection is heuristic-first (keyword scan during check-replies);
  the "Prepare for interview" action is always available regardless.

## 1. Data model — `app/models.py`

### New table `InterviewPrep`
- `id` PK
- `professor_id` FK -> professors, indexed
- `reply_id` FK -> email_replies, nullable (originating reply for context)
- `position_type` String (postdoc|phd|master) — snapshot from professor
- `meeting_format` String (informal_chat|formal_interview|job_talk|panel),
  default `formal_interview`
- `meeting_at` DateTime nullable
- `meeting_notes` Text (platform, timezone, links)
- `briefing` Text
- `fit_analysis` Text
- `talking_points` JSON — array of strings
- `likely_questions` JSON — array of `{question, draft_answer, category}`
- `questions_to_ask` JSON — array of strings
- `logistics` JSON — array of `{item, done}`
- `status` String (draft|ready|completed), default `draft`
- `ai_run_id` FK -> ai_runs, nullable
- `generated_at`, `created_at`, `updated_at` DateTime
- Relationship: `professor` -> Professor

### New table `MockInterview`
- `id` PK
- `prep_id` FK -> interview_prep, indexed
- `transcript` JSON — array of `{role: professor|applicant|feedback, text, at}`
- `status` String (active|completed), default `active`
- `summary` Text nullable (end-of-session feedback)
- `created_at`, `updated_at`, `completed_at` DateTime

### `EmailReply` additions
- `meeting_request` Boolean nullable
- `meeting_intent_at` DateTime nullable

## 2. Migration — `alembic/versions/0010_interview_prep.py`
- down_revision = `0009_reply_management`
- Create `interview_prep` and `mock_interview` tables.
- Add `meeting_request`, `meeting_intent_at` to `email_replies`.
- Apply to the production SQLite DB after writing.

## 3. AI workflows — `ai/runner.py` + `ai/prompts/`

### `Workflow.PREPARE_INTERVIEW = "prepare_interview"`
New template `ai/prompts/prepare_interview.md`. Context passed in params:
user profile (name, role, research interests, education, signature
publications, datasets — respecting the unpublished-work framing rules),
professor (name, university, last_research_summary, hiring_intel, papers via
ProfessorPaper), the reply thread, `position_type`, `meeting_format`.
Branches on `position_type` for depth (Master = lighter, PhD = research-fit,
Postdoc = independent agenda + grants + mentoring).
Output JSON: `{briefing, fit_analysis, talking_points[], likely_questions:[{question, draft_answer, category}], questions_to_ask[], logistics[]}`.

### `Workflow.MOCK_INTERVIEW = "mock_interview"`
New template `ai/prompts/mock_interview.md`. Context: same professor/user
context + the `InterviewPrep` materials + the running `transcript` + the
applicant's latest answer (empty on first turn). Quill role-plays the
professor. Output JSON: `{professor_message, feedback_on_last_answer, done}`.
`feedback_on_last_answer` empty on the first turn.

Both follow the existing render_prompt + HOUSE_STYLE preamble pattern.

## 4. Backend endpoints — `app/main.py`

Serializer `_prep_out(p)` and `_mock_out(m)`.

- `GET  /api/interview-prep` — list all preps with professor context (page).
- `GET  /api/professors/:pid/interview-prep` — fetch prep for one professor
  (404 if none).
- `POST /api/professors/:pid/interview-prep` — generate/regenerate. Body
  `{meeting_format?, meeting_at?, reply_id?, refresh_professor?}`. Runs
  PREPARE_INTERVIEW via an async helper modeled on `_draft_reply_response()`;
  upserts the `InterviewPrep` row; advances `professor.status` to `interview`;
  writes an Activity entry.
- `PATCH /api/interview-prep/:id` — save user edits to any section + meeting
  fields + status + logistics done-flags.
- `DELETE /api/interview-prep/:id`.
- `POST /api/interview-prep/:id/mock/start` — create `MockInterview`, run
  MOCK_INTERVIEW for the opening question, return `{mock_id, professor_message}`.
- `POST /api/mock/:mid/turn` — body `{answer}`. Append applicant turn, run
  MOCK_INTERVIEW, append professor + feedback turns, return next message +
  feedback.
- `POST /api/mock/:mid/finish` — mark completed; run one final MOCK_INTERVIEW
  call for a session `summary`.

Post-interview thank-you and meeting-confirmation emails reuse the existing
`/api/replies/:rid/draft-response` + `/send-response` machinery — no new email
endpoint. The prep detail view links to the originating reply.

## 5. Meeting detection — `app/main.py` check-replies

In the reply-storing path of `/api/sent/check-replies`, run a keyword scan
(meeting, call, chat, zoom/teams/meet, available, schedule, interview, "happy
to talk") over subject + body; set `meeting_request` + `meeting_intent_at`.
Purely a UI nudge/badge; does not gate the prep action.

## 6. Frontend — `web/src/lib/api.ts`
- Types: `InterviewPrep`, `LikelyQuestion`, `MockTurn`, `MockInterview`,
  extend `SentReply` with `meeting_request`.
- Methods: `listInterviewPreps()`, `getInterviewPrep(pid)`,
  `generateInterviewPrep(pid, body)`, `patchInterviewPrep(id, patch)`,
  `deleteInterviewPrep(id)`, `startMock(prepId)`, `mockTurn(mid, answer)`,
  `finishMock(mid)`.

## 7. Frontend — new page `web/src/pages/InterviewPrep.tsx`
- Route `/interview-prep` in `App.tsx`; nav link in `Layout`.
- List view: cards per prep (professor, university, meeting date, format
  selector, status chip). Empty state explains the feature.
- Detail view (selected prep): sections — header (format, datetime, status),
  Briefing, Fit analysis (gaps highlighted), Talking points (editable list),
  Question bank (accordion: question + editable answer draft per item),
  Questions to ask, Logistics checklist (checkboxes). Each section editable
  with debounced PATCH save. Regenerate button.
- Casing: follow the dashboard all-uppercase-words text rule.

## 8. Frontend — mock interview UI (within `InterviewPrep.tsx`)
- "Start mock interview" -> chat panel: professor messages on the left,
  applicant textarea (auto-resize, per existing AutoTextarea pattern) to
  answer, inline feedback shown under each answered turn. "Finish" -> shows
  session summary.

## 9. Wiring
- `Sent.tsx` `ReplyCard`: add "Prepare for interview" button (highlighted when
  `meeting_request`) -> navigates to `/interview-prep?prof=:pid&reply=:rid`
  and triggers generation if no prep exists.
- `quill:data-changed` event dispatched on prep generate / mock turns so other
  pages refresh.

## 10. Verification
- `alembic upgrade head` clean; new tables present.
- Backend imports OK; FastAPI TestClient exercises all new endpoints.
- Generate a prep live against a real professor (e.g. Eric Granger reply);
  confirm coherent position-type-appropriate output.
- Run a full mock interview loop (start -> 3 turns -> finish).
- `tsc --noEmit` clean for new/changed frontend files; `npm run build`.
- Manually click through the page in the browser.
- User restarts the FastAPI backend so new endpoints go live (Vite HMR
  handles frontend).

## Build order
1 -> 2 -> 3 -> 4 -> 5 (backend) then 6 -> 7 -> 8 -> 9 (frontend) -> 10.
