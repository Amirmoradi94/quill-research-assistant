# Dashboard UI/UX Redesign Plan

**Date:** 2026-06-09  
**Status:** Proposed plan, not implemented  
**Goal:** Redesign every dashboard page into a focused academic application workstation.

## Reference Direction

Use a blended direction:

- **Shadcraft dashboard** as the implementation baseline: Tailwind-friendly, shadcn-like, dense dashboard layout, good match for the current React app.
- **Edda online learning dashboard** as the educational/research tone: calmer hierarchy, progress-oriented surfaces, clear "next action" framing.
- **SnowUI dashboard kit** as the component library reference: tables, filters, KPI cards, charts, status chips, empty states, and admin dashboard patterns.

Primary product feeling: a quiet academic operations tool, not a marketing site and not a generic admin template.

## Global Design System

### Visual Language

- Use a neutral, high-readability base: off-white page background, white content panels, dark ink text, restrained borders.
- Keep radius at `6px` or `8px` for cards, inputs, tables, and modals.
- Avoid large decorative gradients, blob backgrounds, and oversized hero sections.
- Use one primary accent for action, one amber/warning accent for follow-ups, one green/success accent for replies, and one rose/error accent.
- Typography should be compact but readable: page titles around `28-32px`, section headings `15-18px`, table text `13-14px`.
- Keep letter spacing at `0` except small uppercase labels where the current UI already uses it.

### Layout Shell

- Keep left sidebar, main workspace, and right Quill rail, but make them feel like one product surface.
- Add a sticky top workspace header inside the main content area with:
  - page title
  - short context line
  - primary action
  - optional search/filter controls
- Convert the sidebar into grouped navigation:
  - **Workspace:** Home, Profile
  - **Pipeline:** Discover, Professors, Drafts, Batches, Sent, Interview Prep
  - **Materials:** Grants, Documents, Calendar
  - **System:** Activity, AI Runs, Settings
- Show compact badges in sidebar for due follow-ups, drafts, sent replies, and pending interview prep.

### Reusable Components

- `PageHeader`: title, subtitle, actions, optional tabs.
- `MetricStrip`: dense KPI cards with trend or context text.
- `FilterBar`: search, segmented controls, select menus, reset button.
- `DataTable`: sticky header, status chips, row actions, compact density.
- `EntityDrawer`: side drawer for quick preview/edit without leaving the table.
- `EmptyState`: small icon, one sentence, one action.
- `Timeline`: activity, sent emails, AI runs, interview prep history.
- `StatusChip`: shared colors for professor, grant, draft, run, and event states.
- `AISummaryPanel`: "what changed", confidence, next suggested action.
- `CommandButton`: icon-first actions with tooltip labels.

### Interaction Standards

- Every page should expose the next likely action within the first viewport.
- Filtering should be visible and persistent; avoid hiding core filters behind menus.
- Prefer drawers for quick inspection and detail pages for deep editing.
- Quill should be contextual: it should know the active page/entity and offer page-specific actions.
- Use optimistic UI only where rollback is trivial; otherwise show loading states.
- Every mutation must produce a visible toast or inline confirmation and update Activity.

## Page-by-Page Plan

## 1. Home

### Purpose

Daily command center for the postdoc search.

### Current Issues

- KPIs are useful but too isolated.
- Recent activity is present, but there is no prioritized work queue.
- Follow-ups are summarized but not actionable enough.

### Redesign

- Top header: "Good evening, Amir" plus a concise status sentence.
- First row: four KPI cards:
  - Total professors
  - Sent
  - Response rate
  - Follow-ups due
- Main two-column layout:
  - Left: "Today" action queue with follow-ups, drafts needing review, interview prep tasks, upcoming calendar items.
  - Right: "Pipeline health" mini chart and status breakdown.
- Below: recent activity timeline with entity links.
- Add a "Continue where you left off" card based on last visited professor/draft/run.

### Components

- `MetricStrip`
- `ActionQueue`
- `PipelineMiniChart`
- `ActivityTimeline`

### Real Test

- Load `/`.
- Confirm `/api/stats`, `/api/activity?limit=8`, and `/api/profile` return `200`.
- Verify no backend error banner appears and KPI values match API values.

## 2. Profile

### Purpose

Single source of truth for the applicant profile that Quill uses.

### Current Issues

- Likely form-heavy and hard to scan.
- Needs stronger separation between identity, research fit, documents, publications, and verified fields.

### Redesign

- Header with profile completion score and "Run CV extraction" action.
- Left column: profile summary card with name, role, affiliation, target role, target countries.
- Main content as tabs:
  - Overview
  - Research Focus
  - Education
  - Publications
  - Experience
  - Awards
  - References
- Add verified-field indicators with lock icons.
- Use inline edit rows for scalar fields.
- Use compact repeated-item cards for publications, education, and references.
- Add a right-side "Quill profile audit" panel:
  - missing fields
  - inconsistent fields
  - suggested fixes

### Components

- `ProfileCompleteness`
- `VerifiedField`
- `InlineEditableField`
- `RepeatableProfileSection`

### Real Test

- Load `/profile`.
- Confirm `/api/user` returns `200`.
- Edit one non-sensitive field in a test-safe way only if explicitly requested, then verify PATCH result and UI update.

## 3. Discover

### Purpose

Find and triage new professor candidates.

### Current Issues

- Discovery candidates should feel like a review queue, not a flat list.
- Needs clear accept, dismiss, and research actions.

### Redesign

- Header: "Discover candidates" with `Run discovery` primary action.
- Add a setup panel for discovery parameters:
  - position type
  - target universities
  - research focus override
  - exclusions
  - count
- Candidate results in a split layout:
  - left: ranked candidate list
  - right: selected candidate preview
- Candidate card fields:
  - match score
  - university
  - category
  - hiring signals
  - research angle
  - source link
- Actions:
  - Add to Professors
  - Research with Quill
  - Dismiss
- Add "why matched" evidence panel.

### Components

- `DiscoveryRunForm`
- `CandidateQueue`
- `MatchScoreBadge`
- `EvidenceList`

### Real Test

- Load `/discover`.
- Confirm suggested-professor fetch returns `200`.
- If running discovery, verify `POST /api/ai/run` streams SSE and creates an `ai_runs` row.

## 4. Professors

### Purpose

Core CRM table for all target professors.

### Current Issues

- Needs stronger table ergonomics: saved filters, clear status chips, quick actions.
- Filters should be server-backed and obvious.

### Redesign

- Header with total count, "Add professor", "Score all", and import/discovery actions.
- Filter bar:
  - search
  - status segmented control
  - tier
  - category
  - university
  - position type
  - saved views: "T1 unsent", "Follow-ups due", "Interview track"
- Main table:
  - professor
  - university
  - category
  - score
  - status
  - last action
  - next action
- Row click opens quick preview drawer.
- Deep link remains `/professors/:id`.
- Add batch actions for selected rows:
  - generate drafts
  - mark status
  - add to batch
  - dismiss suggested

### Components

- `ProfessorTable`
- `ProfessorPreviewDrawer`
- `SavedViewTabs`
- `BulkActionBar`

### Real Test

- Load `/professors`.
- Exercise search and each filter.
- Confirm API query params match visible filters.
- Confirm row click opens the correct professor detail or drawer.

## 5. Professor Detail

### Purpose

Deep workspace for one professor.

### Current Issues

- Detail pages can become dense and scattered.
- Needs a clear "research, draft, contact, timeline" structure.

### Redesign

- Header:
  - name
  - university
  - category
  - score
  - status
  - primary action based on status
- Left main tabs:
  - Overview
  - Papers
  - Draft
  - Contact
  - Timeline
- Right persistent context panel:
  - next action
  - Quill suggestions
  - key links
  - hiring signals
- Papers tab:
  - saved papers with relevance score and one-line relevance summary
  - "Refresh research" button
- Draft tab:
  - current draft editor
  - paper citation checks
  - tone checklist
- Timeline tab:
  - status changes, sent emails, replies, AI runs, notes.

### Components

- `ProfessorHeader`
- `ProfessorTabs`
- `PaperList`
- `DraftEditorPanel`
- `EntityTimeline`

### Real Test

- Load `/professors/:id`.
- Confirm professor, papers, and draft endpoints return `200`.
- Trigger a non-mutating action, such as refresh/reload, and verify UI remains consistent.

## 6. Drafts

### Purpose

Review, edit, and prepare unsent outreach drafts.

### Current Issues

- Draft review needs stronger writing workflow.
- Users need confidence that drafts cite specific papers and meet house style.

### Redesign

- Header with counts:
  - ready
  - needs review
  - skipped
  - missing attachment
- Three-pane layout:
  - left: draft queue with filters
  - center: draft editor
  - right: checklist and professor context
- Checklist:
  - has specific paper reference
  - no forbidden punctuation/style
  - has concrete ask
  - includes correct applicant identity
  - attachment selected
- Actions:
  - redraft
  - save
  - skip
  - mark ready
  - send or mark sent
- Add diff view for redrafts.

### Components

- `DraftQueue`
- `DraftEditor`
- `DraftQualityChecklist`
- `RedraftDiff`

### Real Test

- Load `/drafts`.
- Open a draft and verify `/api/drafts/:id`.
- Save a controlled edit only when requested, then verify persisted body.

## 7. Batches

### Purpose

Plan scheduled outreach groups.

### Current Issues

- Batch generation needs to be understandable and adjustable.
- The scheduling algorithm should be visible enough to trust.

### Redesign

- Header with "Generate batch" and "Mark selected sent".
- Batch controls as a compact panel:
  - batch size
  - max per university
  - weekdays
  - tiers
  - categories
  - universities
- Calendar-like batch preview:
  - each day as a column
  - professors grouped by scheduled send day
- Warnings:
  - missing email
  - no draft
  - duplicate university
  - not enough candidates
- Include "why this order" explanation.

### Components

- `BatchControlPanel`
- `BatchCalendarPreview`
- `BatchWarningList`

### Real Test

- Load `/batches`.
- Change batch parameters.
- Confirm `/api/batches` query string changes and visible result updates.

## 8. Sent

### Purpose

Track sent emails, replies, and follow-ups.

### Current Issues

- Needs clearer reply/follow-up workflow.
- Sent rows should surface urgency and next action.

### Redesign

- Header KPIs:
  - sent
  - replied
  - follow-ups due
  - stale without reply
- Table with:
  - professor
  - sent date
  - days since sent
  - status
  - reply count
  - next action
- Split view for selected row:
  - original draft
  - replies
  - generated response draft
- Follow-up queue tab.
- Add quick actions:
  - draft follow-up
  - mark replied
  - dismiss reply
  - prepare interview

### Components

- `SentTable`
- `ReplyThreadPanel`
- `FollowUpQueue`

### Real Test

- Load `/sent`.
- Confirm sent rows API returns `200`.
- Open a reply row and verify content renders without layout overflow.

## 9. Interview Prep

### Purpose

Prepare for professor meetings and mock interviews.

### Current Issues

- Should feel like an academic prep workspace, not a static page.
- Needs clear logistics, talking points, likely questions, and mock practice.

### Redesign

- Header with upcoming meeting context and "Generate prep" action.
- Prep list left, selected prep detail right.
- Detail sections:
  - briefing
  - fit analysis
  - talking points
  - likely questions
  - questions to ask
  - logistics checklist
  - mock interview transcript
- Add meeting status chip:
  - draft
  - ready
  - practiced
  - completed
- Add printable prep summary.

### Components

- `PrepList`
- `BriefingPanel`
- `QuestionBank`
- `MockInterviewPanel`
- `LogisticsChecklist`

### Real Test

- Load `/interview-prep`.
- Confirm prep list endpoint returns `200`.
- Open one prep item and verify nested arrays render correctly.

## 10. Grants

### Purpose

Track grants, fellowships, deadlines, and fit.

### Current Issues

- Grant cards need deadline urgency and application status.
- Should connect to documents and calendar.

### Redesign

- Header with "Find grants", "Add grant", and deadline count.
- Views:
  - Board by status
  - Deadline timeline
  - Table
- Grant card:
  - name
  - deadline
  - amount
  - country/region
  - fit score
  - required materials
  - status
- Detail drawer:
  - eligibility
  - required docs
  - notes
  - linked calendar events
  - Quill actions

### Components

- `GrantBoard`
- `GrantDeadlineTimeline`
- `GrantDetailDrawer`

### Real Test

- Load `/grants`.
- Confirm grants API returns `200`.
- Switch board/table/timeline views and check count consistency.

## 11. Documents

### Purpose

Manage CV, statements, transcripts, sample papers, and attachments.

### Current Issues

- Needs stronger document library behavior.
- Defaults and versions should be obvious.

### Redesign

- Header with upload button and "Extract profile from CV".
- Library layout:
  - kind filters
  - search
  - grid/list toggle
- Document card:
  - kind icon
  - title
  - filename
  - version
  - default badge
  - extracted text status
  - linked drafts count
- Detail drawer:
  - metadata
  - extracted text preview
  - versions
  - set default
  - attach to active drafts
- Add upload progress and validation states.

### Components

- `DocumentLibrary`
- `DocumentCard`
- `DocumentDetailDrawer`
- `UploadDropzone`

### Real Test

- Load `/documents`.
- Confirm documents endpoint returns `200`.
- Test upload only with a disposable file and verify it appears in the list.

## 12. Calendar

### Purpose

Show deadlines, meetings, follow-up reminders, and grant dates.

### Current Issues

- Calendar should connect to the application pipeline, not just show standalone events.

### Redesign

- Header with month/week toggle and "Add event".
- Main calendar with color-coded event kinds:
  - meeting
  - deadline
  - reminder
  - event
- Right agenda panel:
  - today
  - next 7 days
  - overdue follow-ups
- Event drawer:
  - title
  - date/time
  - kind
  - linked professor/grant/draft
  - notes
- Add "create follow-up reminders" from Sent and Professor pages.

### Components

- `CalendarGrid`
- `AgendaPanel`
- `EventDrawer`

### Real Test

- Load `/calendar`.
- Confirm calendar event endpoint returns `200`.
- Create/edit/delete only with explicit user permission.

## 13. Activity

### Purpose

Audit trail for everything that changed.

### Current Issues

- Hidden from sidebar and likely underused.
- Needs filtering and entity links.

### Redesign

- Add Activity under System in sidebar.
- Header with export/filter actions.
- Timeline grouped by date.
- Filters:
  - entity type
  - action type
  - professor
  - date range
- Each row links to the affected entity.
- Add badges for AI-generated, manual, email, calendar, and document actions.

### Components

- `ActivityTimeline`
- `ActivityFilters`

### Real Test

- Load `/activity`.
- Confirm `/api/activity?limit=...` returns `200`.
- Apply filters and verify list updates predictably.

## 14. AI Runs

### Purpose

Debug and review Quill/AI workflow history.

### Current Issues

- Hidden from sidebar, but important for trust and troubleshooting.
- Needs readable run status and output inspection.

### Redesign

- Add AI Runs under System in sidebar.
- Header with provider status and daily cost cap.
- Table:
  - workflow
  - provider
  - status
  - linked entity
  - duration
  - cost
  - created time
- Detail drawer:
  - prompt preview
  - streamed output
  - parsed payload
  - stderr/error
  - related DB changes
- Add cancel/retry for failed or stuck runs.

### Components

- `AIRunTable`
- `RunStatusChip`
- `AIRunDetailDrawer`

### Real Test

- Load `/ai-runs`.
- Confirm `/api/ai/runs?limit=100` returns `200`.
- Verify latest Quill run appears after sending a test message.

## 15. Settings

### Purpose

Configure AI provider, Gmail, UI density, defaults, and safety limits.

### Current Issues

- Settings should be structured and diagnostic.
- Provider state should be visible before Quill fails.

### Redesign

- Use tabbed settings:
  - AI Provider
  - Gmail
  - Batch Defaults
  - UI
  - Data and Backup
- AI tab:
  - selected provider
  - detected CLI paths
  - API key configured state
  - daily cap
  - test provider button
- Gmail tab:
  - connected address
  - last verified
  - test SMTP
  - reply poller status
- UI tab:
  - density
  - Quill rail default open/closed
  - theme tokens
- Data tab:
  - database path
  - export JSON
  - backup now

### Components

- `SettingsTabs`
- `ProviderHealthCard`
- `GmailStatusCard`
- `DangerZone`

### Real Test

- Load `/settings`.
- Confirm `/api/settings` and `/api/ai/providers` return `200`.
- Run provider/Gmail tests only with explicit permission.

## 16. Quill Rail

### Purpose

Contextual AI assistant embedded across the product.

### Current Issues

- Error history persists and can confuse the user.
- Close button has no actual behavior.
- Needs contextual suggestions and better run visibility.

### Redesign

- Header:
  - Quill status
  - provider badge
  - clear history
  - collapse/expand
- Composer:
  - attach button
  - send button
  - stop button
  - contextual placeholder based on page
- Add suggestion chips:
  - Home: "What should I do next?"
  - Professors: "Find top T1 CV professors"
  - Drafts: "Check this draft for paper specificity"
  - Sent: "Who needs follow-up?"
  - Profile: "Audit my profile"
- Show run cards with:
  - provider
  - duration
  - cost
  - tool calls
  - linked DB updates
- Add visible "Clear failed messages" or make clear-history more obvious.
- Fix close behavior by collapsing rail and persisting preference.

### Components

- `QuillRail`
- `SuggestionChips`
- `RunCard`
- `ToolCallList`

### Real Test

- Send "hey" through the UI.
- Confirm `POST /api/ai/run` returns `200 text/event-stream`.
- Confirm new assistant message renders and no red error appears.
- Clear history and verify localStorage no longer shows old error messages.

## Implementation Phases

### Phase 1: Foundation

- Create shared components:
  - `PageHeader`
  - `MetricStrip`
  - `FilterBar`
  - `DataTable`
  - `StatusChip`
  - `EmptyState`
  - `EntityDrawer`
- Update layout shell and sidebar grouping.
- Add Activity and AI Runs to System navigation.
- Normalize spacing, typography, and status colors.

### Phase 2: Core Pipeline

- Redesign Home, Professors, Professor Detail, Drafts, and Sent.
- Prioritize table ergonomics, next actions, and Quill context.
- Add real endpoint tests for each page after implementation.

### Phase 3: Growth and Prep Pages

- Redesign Discover, Batches, Interview Prep, Grants, Documents, and Calendar.
- Add stronger queues, previews, and detail drawers.

### Phase 4: System Trust

- Redesign Activity, AI Runs, Settings, and Quill Rail.
- Add provider health and better error handling.
- Make stale Quill errors easy to clear.

### Phase 5: Polish and Verification

- Mobile/tablet responsive pass.
- Keyboard navigation pass.
- Empty/loading/error states for every page.
- Visual regression screenshots for desktop and narrow viewport.
- API route smoke tests for every page.

## Acceptance Criteria

- Every main page has a clear primary action in the first viewport.
- Every data table has visible search/filter controls and stable row actions.
- Every mutation has a visible success/error state and updates relevant data.
- Quill can send a test message without showing a stale or new fetch error.
- Sidebar navigation is grouped and includes Activity and AI Runs.
- No page relies on oversized hero sections, decorative blobs, or marketing-style composition.
- Desktop layout works at 1280px and 1440px widths.
- Narrow layout works at 390px width without text overlap.

## Test Matrix

Run after each implementation slice:

| Page | Route | Required Smoke Test |
| --- | --- | --- |
| Home | `/` | stats, activity, profile return `200`; no backend banner |
| Profile | `/profile` | user/profile data loads; repeated sections render |
| Discover | `/discover` | candidates load; discovery action streams or fails cleanly |
| Professors | `/professors` | filters change API query and visible rows |
| Professor Detail | `/professors/:id` | professor, papers, draft sections load |
| Drafts | `/drafts` | queue and selected draft render; save path verified when edited |
| Batches | `/batches` | parameter changes update preview |
| Sent | `/sent` | sent rows and reply preview render |
| Interview Prep | `/interview-prep` | prep detail renders nested data |
| Grants | `/grants` | board/table counts match API |
| Documents | `/documents` | library loads; upload path verified only with disposable file |
| Calendar | `/calendar` | event fetch works; create/edit/delete only with permission |
| Activity | `/activity` | timeline loads and filters apply |
| AI Runs | `/ai-runs` | latest Quill run appears after test message |
| Settings | `/settings` | settings and provider status load |
| Quill | all pages | `POST /api/ai/run` streams and renders assistant response |

## Source References

- Figma dashboard templates: https://www.figma.com/templates/dashboard-designs/
- Figma Community guide: https://help.figma.com/hc/en-us/articles/360038510693-Guide-to-the-Figma-Community
- Shadcraft dashboard direction: https://shadcraft.com/templates/dashboard
- Edda online learning dashboard direction: https://www.uidux.com/edda-online-learning-dashboard-ui-for-figma-and-adobe-xd
- SnowUI dashboard kit direction: https://figma.uwarp.design/resources/ui-kits/8b8d777f-aa2f-453a-8306-f8de34936c42
