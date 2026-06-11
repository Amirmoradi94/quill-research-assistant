{# Quill prompt — extract_user_profile_full
   Builds the rich applicant profile from CV text (mandatory) + transcript
   texts (optional, one per degree) + personal page HTML/text (optional).

   Output is consumed by app.quill._apply_workflow_result and written across
   the users + user_education + user_publications + user_experience +
   user_awards + user_references tables. Per-field provenance is recorded
   into users.field_provenance so the UI can show "✨ auto-filled · 0.92".

   Inputs available:
     cv_text                — full text extracted from the CV PDF
     transcript_texts       — list of {"degree_hint": "PhD", "text": "..."}
     personal_page_text     — text scraped from the user's personal website
     existing_profile       — current users row (so the model can preserve
                              fields the user already verified)
#}
You are extracting a STRUCTURED RESEARCHER PROFILE from one or more documents.
The output will populate a database used to (a) draft customized cold-outreach
emails to professors, and (b) match the applicant to professors for discovery.

## Source documents

### CV — primary source (mandatory)

```
{{ cv_text }}
```

{% if transcript_texts %}
### Transcripts — use for GPA, key courses, and to cross-check education entries

{% for t in transcript_texts %}
**Transcript {{ loop.index }}**{% if t.degree_hint %} (likely {{ t.degree_hint }}){% endif %}:
```
{{ t.text }}
```

{% endfor %}
{% endif %}

{% if personal_page_text %}
### Personal page — use for headline, research interests, and current role only

```
{{ personal_page_text }}
```
{% endif %}

{% if existing_profile %}
## Existing profile — fields the user has already verified

These values were either entered manually or already marked verified. **Do not
overwrite them.** Treat them as ground truth; you may *add* new items
(publications, education, etc.) but not modify what is here.

```json
{{ existing_profile | tojson }}
```
{% endif %}

## Extraction rules

1. **CV is the source of truth.** If transcripts or the personal page disagree
   with the CV on dates, titles, advisors, or publications, the CV wins.
2. **Do not invent.** If a field is not present in any source, omit it or set
   `null`. Never guess GPA, advisor name, citation counts, etc.
3. **Per-field confidence** must be honest. 0.95+ for fields stated verbatim,
   0.7-0.9 for fields you inferred reliably, <0.7 for guesses. Anything <0.5
   should just be omitted.
4. **Source attribution**: `"cv"`, `"transcript"`, `"personal_page"`, or
   `"merged"` if you combined sources.
5. **House style for venues**: always spell IEEE journal names in full. The
   `venue_full_name` field must be the official long name (e.g. "IEEE
   Transactions on Intelligent Transportation Systems"). Put the acronym in
   `venue_short` only.
6. **Publication `status` must be accurate**: only use `"published"` for items
   the CV clearly marks as published / accepted. Items in "submitted", "in
   review", "under review", "to appear in", or "in preparation" must use
   `"under_review"` or `"in_prep"`. Conservative defaults are required because
   over-claiming publications in outreach emails is a deal-breaker.
7. **Signature publications**: flag at most 3 publications with
   `is_signature: true` — the ones the applicant would lead with in a cover
   letter. Prefer first-authored, recent, top-venue, well-cited.
8. **Categories** must come from this controlled list (lowercase):
   `cv`, `nlp`, `rl`, `av`, `medical`, `theory`, `robotics`, `or`,
   `renewable`, `adversarial`, `structural`, `geotechnical`,
   `transportation`, `environmental`, `construction`, `materials`,
   `systems`, `water`, `earthquake`. If none fit, omit the category rather
   than inventing one.
9. **Methods / domains / tools** are free-form short strings (2-4 words).
   Aim for 4-10 entries per list. De-duplicate semantically (don't list both
   "neural networks" and "deep learning").
10. **Dates**: use `YYYY-MM-DD`. If only the year is known, use `YYYY-01-01`
    and set confidence ≤ 0.7.
11. **Headline**: write a single sentence (≤ 90 chars) describing the
    applicant's research focus in their own register. Use the CV summary
    section if present; otherwise distill it from the publications list. Do
    not start with "I" or "My research".
12. **Application target fields** (`target_position_type`, `target_countries`,
    `funding_status`, `work_authorization`, etc.) are USER-PROVIDED, not
    extractable from a CV. Omit them entirely from the output unless the
    personal page explicitly states them.
13. **Thesis abstract**: include only if the CV or transcript contains an
    actual abstract. Do not summarize the thesis title.

## Output

Return ONLY this JSON, no commentary before or after. Every leaf value that
came from extraction (not a copy of `existing_profile`) must also appear in
`field_provenance` with `{source, confidence}`.

```json
{
  "user": {
    "name": "...",
    "preferred_name": "...",
    "pronouns": null,
    "email": "...",
    "email_secondary": null,
    "phone": null,
    "city": "...",
    "country": "...",
    "nationality": null,
    "languages": [{"lang": "English", "level": "native"}],
    "orcid": "0000-...",
    "scholar_url": "https://scholar.google.com/...",
    "github": "...",
    "linkedin": "...",
    "website": "...",
    "twitter": null,
    "current_role": "Postdoctoral researcher",
    "affiliation": "McGill University, ECE",
    "headline": "...",
    "research_interests": "...",
    "research_categories": ["cv", "av"],
    "methods": ["deep learning", "sensor fusion"],
    "application_domains": ["autonomous vehicles"],
    "tools_frameworks": ["PyTorch", "ROS"],
    "datasets_used": ["KITTI", "nuScenes"],
    "datasets_created": [
      {"name": "Montreal driving dataset", "status": "private"}
    ],
    "programming_languages": [
      {"name": "Python", "proficiency": "expert"},
      {"name": "C++", "proficiency": "advanced"}
    ],
    "certifications": [],
    "reviewing_venues": ["IEEE Transactions on Intelligent Transportation Systems", "ICRA"],
    "teaching_summary": "TA for ECSE-512 (Digital Signal Processing) 2024-2025"
  },
  "education": [
    {
      "degree_level": "PhD",
      "field": "Electrical and Computer Engineering",
      "institution": "McGill University",
      "department": "Department of ECE",
      "start_date": "2021-09-01",
      "end_date": "2026-04-01",
      "is_current": false,
      "gpa": 4.0,
      "gpa_scale": 4.0,
      "honors": null,
      "advisor_name": "Prof. ...",
      "advisor_title": "Professor of ECE",
      "co_advisor_name": null,
      "thesis_title": "...",
      "thesis_abstract": null,
      "key_courses": [
        {"name": "Advanced Machine Learning", "grade": "A", "year": 2022}
      ]
    }
  ],
  "publications": [
    {
      "title": "...",
      "authors": "A. Moradi, B. Smith, C. Jones",
      "venue_full_name": "IEEE Transactions on Intelligent Transportation Systems",
      "venue_short": "T-ITS",
      "year": 2026,
      "type": "journal",
      "status": "under_review",
      "doi": null,
      "url": null,
      "citation_count": null,
      "your_role": "first author, lead design and experiments",
      "abstract": null,
      "one_line_takeaway": "An end-to-end perception model robust to fog and snow on automotive lidar.",
      "is_signature": true
    }
  ],
  "experience": [
    {
      "title": "Postdoctoral researcher",
      "employer": "McGill University",
      "lab_or_group": "...",
      "supervisor": "...",
      "location": "Montreal, CA",
      "start_date": "2026-05-01",
      "end_date": null,
      "is_current": true,
      "bullets": [
        "Led development of multi-sensor fusion pipeline for adverse-weather AV perception."
      ],
      "tech_used": ["PyTorch", "ROS"]
    }
  ],
  "awards": [
    {
      "name": "NSERC Postdoctoral Fellowship",
      "granting_body": "NSERC",
      "amount": 70000,
      "currency": "CAD",
      "year": 2026,
      "type": "fellowship",
      "notes": null
    }
  ],
  "references": [
    {
      "name": "Prof. ...",
      "title": "Professor",
      "institution": "McGill University",
      "email": "...",
      "relationship_type": "PhD advisor",
      "years_known": 5,
      "notes": null
    }
  ],
  "field_provenance": {
    "name":               {"source": "cv", "confidence": 0.99},
    "email":              {"source": "cv", "confidence": 0.99},
    "headline":           {"source": "personal_page", "confidence": 0.85},
    "research_categories":{"source": "merged", "confidence": 0.8},
    "education[0].gpa":   {"source": "transcript", "confidence": 0.97},
    "publications[0].status": {"source": "cv", "confidence": 0.95}
  }
}
```

End of instructions. Return only the JSON object above with real values.
