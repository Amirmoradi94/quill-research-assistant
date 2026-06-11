# Profile page — wireframe

Single scrollable page with a sticky left rail of section anchors and a sticky
right rail "Auto-fill" panel. Visual language matches existing dashboard tokens
(`--color-paper`, `--color-cat-*`, etc.).

## Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Home / Profile                                                            │
├──────────┬─────────────────────────────────────────────────┬───────────────┤
│ Anchors  │  Hero card                                      │  Auto-fill    │
│ (sticky) │  ┌────────────────────────────────────────────┐ │  (sticky)     │
│          │  │ [photo]  Amir Moradi  · he/him             │ │               │
│ Identity │  │          Postdoctoral candidate            │ │  CV  *.pdf    │
│ Target ◉ │  │          "ML for AV in adverse weather"    │ │  ✅ extracted │
│ Educat'n │  │          Montreal, CA · alltableai@…       │ │     5 d ago   │
│ Researh  │  │          [orcid] [scholar] [github] [www]  │ │  [Re-extract] │
│ Pubs     │  └────────────────────────────────────────────┘ │               │
│ Experien │                                                 │  Transcripts  │
│ Awards   │  ── 1. Identity ────────────────────────────────│  PhD.pdf  ✅  │
│ Skills   │  Name        [Amir Moradi]                      │  MSc.pdf  ✅  │
│ Service  │  Preferred   [Amir]                             │  [+ add]      │
│ Refs     │  Pronouns    [he/him]                           │               │
│ Docs     │  Photo URL   [https://...]                      │  Personal     │
│          │  ┌──────────── Contact ─────────────────────┐   │  page         │
│          │  │ Primary email   [alltableai@gmail.com]   │   │  url …        │
│          │  │ Phone           [...........]            │   │  ✅ scraped   │
│          │  │ City            [Montreal]               │   │               │
│          │  │ Country         [Canada]                 │   │  Sample paper │
│          │  │ Nationality     [Iran]                   │   │  [drop file]  │
│          │  │ Languages       ⊕ English (native)       │   │               │
│          │  │                 ⊕ French (B2)            │   │  ─────────────│
│          │  │                 [+ add language]         │   │  Run full     │
│          │  └──────────────────────────────────────────┘   │  extraction   │
│          │  ┌────── Online presence ──────────────────┐    │  [ ▷ Start ]  │
│          │  │ ORCID  Scholar  GitHub  LinkedIn  WWW … │    │               │
│          │  └─────────────────────────────────────────┘    │  Cost so far  │
│          │                                                 │  $0.04        │
│          │  ── 2. Application target ──────────────────────│               │
│          │  Position type  ( • postdoc  ○ phd  ○ master )  │               │
│          │  Start date     [2026-09-01]                    │               │
│          │  Funding status (▾ have_scholarship)            │               │
│          │  Target ctry    [CA] [US] [+]                   │               │
│          │  Excluded inst. [...] [+]                       │               │
│          │  Work auth      CA: PR  · US: needs visa  [+]   │               │
│          │  Commitment     ( ○ 1y  • 2y  ○ open )          │               │
│          │                                                 │               │
│          │  ── 3. Education ───────────────────  [+ add]   │               │
│          │  ┌─ PhD · ECE · McGill · 2021–2026 ─────────┐   │               │
│          │  │ Advisor: Prof. X · Co-advisor: Prof. Y   │   │               │
│          │  │ Thesis: "..."                            │   │               │
│          │  │ GPA 4.0/4.0 · honors: ...                │   │               │
│          │  │ Transcript: PhD-transcript.pdf ✅        │   │               │
│          │  │ Key courses: [Advanced ML · A]  [+]      │   │               │
│          │  │                              [edit][del] │   │               │
│          │  └──────────────────────────────────────────┘   │               │
│          │  ┌─ MSc · ECE · Sharif U · 2018–2020 ──────┐    │               │
│          │  │ ...                                     │    │               │
│          │  └─────────────────────────────────────────┘    │               │
│          │                                                 │               │
│          │  ── 4. Research profile ────────────────────────│               │
│          │  Headline    [ML for AV in adverse weather]     │               │
│          │  Long bio    ┌──────────────────────────────┐   │               │
│          │              │ (paragraph, edit inline)     │   │               │
│          │              └──────────────────────────────┘   │               │
│          │  Categories  • cv  • av  • rl   [+]             │               │
│          │  Methods     [deep learning] [MPC] [diffusion]…│               │
│          │  Domains     [autonomous vehicles] [healthcare]│               │
│          │  Tools       [PyTorch] [ROS] [JAX]              │               │
│          │  Datasets I  [KITTI] [nuScenes]                 │               │
│          │   use                                           │               │
│          │  Datasets I  Montreal driving · private 🔒      │               │
│          │   created    [+ add]                            │               │
│          │                                                 │               │
│          │  ── 5. Publications ────────────────  [+ add]   │               │
│          │  ⭐ signature │ title │ venue │ year │ status   │               │
│          │  ☆  Multi-mod sensor fusion … │ IEEE T-ITS │ 26 │ under review │ │
│          │  ★  Adversarial robust depth │ ICRA      │ 25 │ published   │  │
│          │     one-line:  "first end-to-end depth model … "│              │
│          │  ☆  ...                                         │               │
│          │  Sort ▾  Filter signature ▾                     │               │
│          │                                                 │               │
│          │  ── 6. Experience ──────────────────  [+ add]   │               │
│          │  Postdoc fellow · McGill · 2026–present         │               │
│          │  PhD researcher · McGill · 2021–2026            │               │
│          │  Visiting researcher · MIT · summer 2023        │               │
│          │                                                 │               │
│          │  ── 7. Awards & funding ────────────  [+ add]   │               │
│          │  NSERC PDF · CAD 70k · 2026 · fellowship        │               │
│          │  IEEE best paper · 2024                         │               │
│          │                                                 │               │
│          │  ── 8. Skills ──────────────────────────────────│               │
│          │  Programming: Python (expert), C++ (advanced)…  │               │
│          │  Certifications: …                              │               │
│          │  Languages   linked to Identity ↑               │               │
│          │                                                 │               │
│          │  ── 9. Service & teaching ──────────────────────│               │
│          │  Reviewing: IEEE T-ITS, ICRA, NeurIPS           │               │
│          │  Teaching:  TA for ECSE-512 (2024,2025)         │               │
│          │                                                 │               │
│          │  ── 10. References ─────────────────  [+ add]   │               │
│          │  Prof. X · ECE McGill · phd advisor · 5y · ✉…  │               │
│          │                                                 │               │
└──────────┴─────────────────────────────────────────────────┴───────────────┘
```

## Field-level UI patterns

- **Auto-filled values** get a subtle ✨ badge in the corner of the field with a
  tooltip "Auto-filled from CV · 2026-05-12 · 0.92 confidence — click to mark
  verified". Once the user edits or hits "verified", the badge turns ✓.
- **Provenance** is read from `user.field_provenance[field_name]`. Editing a
  field flips `verified_by_user: true` and locks it from being overwritten on
  the next re-extraction.
- **Chip arrays** (categories / methods / domains / tools) use the existing
  `--color-cat-*` palette where applicable so the colour language matches the
  Professors and Batches pages. New chips fall back to `--color-paper-3`.
- **Repeatable cards** (education, publications, experience, awards,
  references) are drag-orderable via `order_idx`. Each card collapses to a
  one-liner when not focused.

## Right rail — "Auto-fill" panel

| Source       | Status                                   | Action          |
|--------------|------------------------------------------|-----------------|
| CV (req.)    | `cv_doc_id` set ✅ / last extracted date | [Re-extract]    |
| Transcripts  | per-degree, list                         | [+ add]         |
| Personal pg. | URL field + last scraped time            | [Refresh]       |
| Sample paper | optional                                 | [Upload]        |

Bottom of rail: **Run full extraction** button → triggers the
`extract_user_profile_full` workflow (see prompt below). Shows running cost from
the last 24 h of `ai_runs` with `workflow = extract_user_profile_full`.

## States

- **Empty profile**: hero card replaced with a "Drop your CV to get started"
  block. Everything below is greyed out until `cv_doc_id` is set.
- **Extraction running**: the right rail expands to show a live SSE log feed
  (re-use the Quill stream component from the Discover page).
- **Conflicts**: if a re-extraction wants to overwrite a `verified_by_user`
  field, surface a diff modal — user picks "keep mine" / "use new" per field.

## API endpoints (proposed)

| Method | Path                                  | Purpose                       |
|--------|---------------------------------------|-------------------------------|
| GET    | `/api/user`                           | Full nested profile           |
| PATCH  | `/api/user`                           | Partial update scalars        |
| POST   | `/api/user/education`                 | Add education item            |
| PATCH  | `/api/user/education/{id}`            | Update item                   |
| DELETE | `/api/user/education/{id}`            | Delete item                   |
| (same shape for publications / experience / awards / references)             |
| POST   | `/api/user/extract`                   | Trigger full extraction; SSE  |
| POST   | `/api/user/field/{name}/verify`       | Mark a field as user-verified |
