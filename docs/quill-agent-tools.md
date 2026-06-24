# Quill Agent Tool Registry

This document defines the backend tools Quill should expose to an OpenRouter
model such as `z-ai/glm-5.2`.

These are not Claude/Codex CLI tools. They are typed application actions that
the Quill backend executes on behalf of the model. The model proposes a tool
call, the backend validates it, runs the handler, records an audit event, and
returns a compact result to the model.

## Design Rules

- Expose Quill domain tools, not shell access.
- Keep tools small, typed, and predictable.
- Use read tools freely.
- Require user confirmation for email sending, destructive actions, and broad
  bulk mutations.
- Never expose raw SQL, arbitrary filesystem access, arbitrary HTTP fetch, or
  secret values to the model.
- Prefer background workflow tools for long-running work.
- Return summaries and IDs, not huge records, unless the user asks for full
  text.

## Permission Levels

| Level | Meaning | Examples |
| --- | --- | --- |
| `read` | No state change. Safe to call automatically. | List drafts, get profile, read document text. |
| `write` | Changes local Quill data. Allowed when user clearly asks. | Edit draft, update professor, create event. |
| `confirm` | Requires explicit UI confirmation before execution. | Send email, delete records, bulk status change. |
| `admin` | Settings or secrets. Must be handled by UI forms, not model output. | Save OpenRouter key, configure Gmail password. |

## MVP Tool Set

These are enough for the first useful OpenRouter agent.

| Tool | Level | Purpose | Main Inputs | Maps To |
| --- | --- | --- | --- | --- |
| `dashboard.get_overview` | `read` | Summarize stats, recent activity, active drafts, and recent AI runs. | optional limits | `/api/stats`, `/api/activity`, `/api/drafts`, `/api/ai/runs` |
| `profile.get` | `read` | Read the full user research profile. | none | `GET /api/user` |
| `profile.update` | `write` | Update profile fields after the user asks. | field patch object | `PATCH /api/user` |
| `profile.verify_field` | `write` | Lock a corrected profile field. | `field_name` | `POST /api/user/field/{field_name}/verify` |
| `profile.list_section` | `read` | List repeatable profile rows. | section | profile child tables |
| `profile.create_section_item` | `write` | Add education, publication, experience, award, or reference rows. | section, item | profile child tables |
| `profile.update_section_item` | `write` | Edit one repeatable profile row. | section, item_id, patch | profile child tables |
| `professors.search` | `read` | Find professors by text, status, tier, category, university, or suggestion state. | filters, limit | `GET /api/professors` |
| `professors.get` | `read` | Load one professor with saved metadata. | `professor_id` | `GET /api/professors/{pid}` |
| `professors.update` | `write` | Edit professor metadata, notes, status, tier, or contact fields. | `professor_id`, patch | `PATCH /api/professors/{pid}` |
| `professors.score` | `write` | Recompute fit score for one professor. | `professor_id` | `POST /api/professors/{pid}/score` |
| `papers.list_for_professor` | `read` | Read saved papers for a professor. | `professor_id` | `GET /api/professors/{pid}/papers` |
| `drafts.list` | `read` | List active drafts with professor context. | filters, limit | `GET /api/drafts` |
| `drafts.get` | `read` | Read a full draft body before editing. | `draft_id` | `GET /api/drafts/{did}` |
| `drafts.create` | `write` | Create a manual draft. | `professor_id`, subject, body | `POST /api/drafts` |
| `drafts.update` | `write` | Revise subject and/or body. | `draft_id`, subject, body | `PATCH /api/drafts/{did}` |
| `drafts.skip` | `write` | Hide a draft from the active Drafts page. | `draft_id` | `POST /api/drafts/{did}/skip` |
| `drafts.unskip` | `write` | Restore a skipped draft. | `draft_id` | `POST /api/drafts/{did}/unskip` |
| `email.send_draft` | `confirm` | Send a draft through connected Gmail. | `draft_id` | `POST /api/drafts/{did}/send` |
| `documents.list` | `read` | List uploaded CVs, transcripts, and other documents. | optional `kind` | `GET /api/documents` |
| `documents.get` | `read` | Read document metadata and extracted text. | `document_id` | `GET /api/documents/{doc_id}` |
| `ai.run_workflow` | `write` | Start long-running Quill workflows. | workflow, top-level IDs, params | `POST /api/ai/run/background` |
| `ai.get_run` | `read` | Check an AI run status and result. | `run_id` | `GET /api/ai/runs/{run_id}` |
| `ai.list_runs` | `read` | List recent AI runs. | filters, limit | `GET /api/ai/runs` |
| `ai.cancel_run` | `write` | Cancel a queued or running AI job. | `run_id` | `POST /api/ai/runs/{run_id}/cancel` |

## Implemented In Web Agent

The current web agent exposes these backend-executed tools to the model:

- Read tools: `dashboard.get_overview`, `profile.get`, `professors.search`,
  `professors.get`, `papers.list_for_professor`, `drafts.list`, `drafts.get`,
  `documents.list`, `documents.get`, `calendar.list_events`, `grants.list`,
  `activity.list`, `ai.get_run`, `ai.list_runs`, and
  `profile.list_section`.
- Write tools: `profile.update`, `profile.verify_field`, `professors.update`,
  `drafts.create`, `drafts.update`, `drafts.skip`, `drafts.unskip`,
  `calendar.create_event`, `ai.run_workflow`, `profile.create_section_item`,
  and `profile.update_section_item`.

`profile.update` is only for scalar user fields. For repeatable profile data,
including publications, Quill should use section tools instead of telling the
user to re-run extraction. Supported sections are `education`, `publications`,
`experience`, `awards`, and `references`.

`documents.get` returns metadata plus extracted text stored for uploaded PDFs,
CVs, transcripts, sample papers, statements, and other documents. If a user
asks Quill to read a CV PDF, Quill should call `documents.list` to find the CV
and then `documents.get` with the chosen `document_id`; it should not claim it
lacks a PDF-reading tool when extracted text exists.

Confirmation-gated tools such as sending email, deleting records, bulk actions,
and settings/secret changes are intentionally not exposed until the web UI has
an explicit confirmation handoff for model-proposed actions.

## Workflow Tool

`ai.run_workflow` should be the only model-facing entry point for long-running
research tasks.

Supported workflows:

| Workflow | Required Inputs | Notes |
| --- | --- | --- |
| `discover_professors` | `params.position_type`, `params.count` | Finds suggested professors. |
| `research_professor` | top-level `professor_id` | Refreshes lab/profile/paper context. |
| `draft_email` | top-level `professor_id` | Generates or regenerates outreach draft. |
| `draft_reply` | reply context, usually backend-created | Drafts a response to a professor reply. |
| `extract_user_profile_full` | top-level `document_id` | Refills profile from uploaded CV/document. |
| `prepare_interview` | top-level `professor_id` | Creates interview prep material. |
| `mock_interview` | mock session context | Produces interview turn feedback. |
| `find_grants` | optional search params | Finds grants/fellowships. |

Important: `professor_id`, `document_id`, and `grant_id` stay top-level in the
request body, not inside `params`.

## Full Tool Set

These tools can be added after the MVP agent loop is stable.

### Professors

| Tool | Level | Purpose |
| --- | --- | --- |
| `professors.create` | `write` | Add a professor manually. |
| `professors.delete` | `confirm` | Delete a professor. |
| `professors.score_all` | `confirm` | Recompute all professor scores. |

### Drafts And Email

| Tool | Level | Purpose |
| --- | --- | --- |
| `drafts.generate_batch` | `confirm` | Generate drafts for multiple professors. |
| `drafts.mark_sent` | `confirm` | Mark a draft sent without Gmail send. |
| `drafts.attach_document` | `write` | Attach a document to one draft. |
| `drafts.bulk_attach_document` | `confirm` | Attach a document to many drafts. |
| `email.sent.list` | `read` | List sent outreach. |
| `email.sent.check_replies` | `write` | Check Gmail for replies. |
| `email.replies.draft_response` | `write` | Generate a reply draft. |
| `email.replies.update` | `write` | Edit a reply draft. |
| `email.send_reply` | `confirm` | Send a drafted reply through Gmail. |

### Documents

| Tool | Level | Purpose |
| --- | --- | --- |
| `documents.create` | `write` | Upload or create a document through a controlled UI flow. |
| `documents.update` | `write` | Edit document metadata. |
| `documents.delete` | `confirm` | Delete a document. |
| `profile.extract_from_document` | `write` | Trigger profile extraction from a selected document. |

### Calendar

| Tool | Level | Purpose |
| --- | --- | --- |
| `calendar.list_events` | `read` | Read all events or a date range. |
| `calendar.create_event` | `write` | Create meeting, reminder, event, or deadline. |
| `calendar.update_event` | `write` | Edit event fields. |
| `calendar.delete_event` | `confirm` | Delete an event. |

### Grants

| Tool | Level | Purpose |
| --- | --- | --- |
| `grants.list` | `read` | List grants and fellowships. |
| `grants.create` | `write` | Create a grant record. |
| `grants.update` | `write` | Edit grant fields. |
| `grants.delete` | `confirm` | Delete a grant record. |

### Interview Prep

| Tool | Level | Purpose |
| --- | --- | --- |
| `interview.list_prep` | `read` | List saved interview prep. |
| `interview.get_prep` | `read` | Read one prep record. |
| `interview.generate_prep` | `write` | Generate prep for a professor. |
| `interview.update_prep` | `write` | Edit saved prep. |
| `interview.delete_prep` | `confirm` | Delete prep. |
| `interview.mock_start` | `write` | Start mock interview. |
| `interview.mock_turn` | `write` | Submit answer and get next turn. |
| `interview.mock_finish` | `write` | Finish mock interview and save feedback. |

### Activity And Export

| Tool | Level | Purpose |
| --- | --- | --- |
| `activity.list` | `read` | List recent activity. |
| `activity.log` | `write` | Add a timeline entry. |
| `export.data` | `read` | Export app data through the existing export endpoint. |

### Settings

| Tool | Level | Purpose |
| --- | --- | --- |
| `settings.get` | `read` | Read non-secret settings and connection status. |
| `settings.update_preferences` | `write` | Update safe preferences such as UI density or default model slug. |
| `settings.test_gmail` | `confirm` | Test Gmail credentials without exposing secrets. |
| `settings.get_ai_providers` | `read` | Return OpenRouter provider status and model. |

Do not expose a model-facing `settings.update_secret` tool. API keys and Gmail
passwords should only be entered through UI forms.

## External Research Tools

OpenRouter models should not receive general web or shell access. If Quill needs
web research, expose controlled tools:

| Tool | Level | Purpose |
| --- | --- | --- |
| `web.search` | `read` | Search the public web with query, domain allowlist, and result limit. |
| `web.fetch_url` | `read` | Fetch text from a single safe URL with size limits. |
| `scholar.search_papers` | `read` | Search academic papers through a structured provider. |
| `professor_site.scrape` | `read` | Scrape one professor/lab page with allowlisted protocols and text limits. |

Each external research tool should enforce timeouts, maximum bytes, no local
network access, and no credential forwarding.

## Tools To Exclude

Do not give GLM/OpenRouter any of these:

- `bash`
- raw filesystem read/write
- raw SQL
- arbitrary HTTP client
- direct Gmail SMTP credentials
- direct Send Email without confirmation
- direct Delete without confirmation
- direct OpenRouter/Gmail secret update
- Claude CLI or Codex CLI provider controls

## Implementation Shape

Each tool should be registered with:

```json
{
  "name": "drafts.update",
  "description": "Revise the subject and/or body of one saved outreach draft.",
  "permission": "write",
  "input_schema": {
    "type": "object",
    "properties": {
      "draft_id": { "type": "integer" },
      "subject": { "type": "string" },
      "body": { "type": "string" }
    },
    "required": ["draft_id"]
  }
}
```

The OpenRouter loop should:

1. Send `messages` plus OpenAI-compatible `tools` schemas to OpenRouter.
2. Read `tool_calls` from the model response.
3. Validate each tool name and input schema server-side.
4. If the tool requires confirmation, return a pending confirmation object to
   the UI and stop.
5. Execute safe tools through backend handlers.
6. Append each `tool` result to `messages`.
7. Continue until the model returns final text.

## Recommended First Milestone

Implement only these ten tools first:

- `dashboard.get_overview`
- `profile.get`
- `professors.search`
- `professors.get`
- `papers.list_for_professor`
- `drafts.list`
- `drafts.get`
- `drafts.update`
- `ai.run_workflow`
- `ai.get_run`

This gives GLM enough agency to answer questions, inspect the dashboard, revise
drafts, and start Quill workflows without exposing dangerous capabilities.
