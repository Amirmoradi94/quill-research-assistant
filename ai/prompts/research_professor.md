{# Quill prompt — research_professor
   Deep-scrapes a professor's public web presence.
   Captures hiring signals for postdoc / PhD / Master positions and
   any contact instructions they publish.

   The backend pre-scrapes using the Scrapling service and injects:
     scraped_main       — ScrapeResult of the main profile page (may be None)
     scraped_subpages   — list[ScrapeResult] of hiring/openings sub-pages
     s2_papers          — list of papers from Semantic Scholar (may be empty)
   If scraped_main is absent, fall back to WebFetch. #}
You are helping {{ user.name }}, a {{ user.current_role }} at
{{ user.affiliation }}, researching {{ user.research_interests }}.

Task: research Professor {{ professor.name }} at {{ professor.university }}.
{% if professor.position_type %}They are targeting a **{{ professor.position_type }}** position.{% endif %}

{% if scraped_main and scraped_main.ok %}
## Pre-fetched page content (use this — no need to WebFetch the main page)

### Main profile: {{ scraped_main.final_url or professor.profile_url }}

{{ scraped_main.markdown or scraped_main.text }}

{% if scraped_subpages %}
### Hiring / prospective-student sub-pages (pre-fetched)

{% for page in scraped_subpages %}
#### {{ page.final_url or page.url }}

{{ page.markdown or page.text }}

---
{% endfor %}
{% else %}
No hiring-specific sub-pages were found automatically. If you notice any links
in the content above that look like "join us", "openings", "prospective students"
etc., and they are on the same domain as the professor's own page (not the
university's general site), use WebFetch to retrieve them.
{% endif %}

{% else %}
{# Scraper service was unavailable — fall back to WebFetch #}
{% if professor.profile_url -%}
Start at: {{ professor.profile_url }}
{%- else -%}
First search for their faculty profile page, then proceed.
{%- endif %}

Use WebFetch to retrieve the professor's profile. Then look for any links or
sections containing words like "prospective", "join us", "openings", "positions",
"opportunities", "apply", "PhD students", "Master students", "Postdoc", "hiring".

**Important:** only follow links that stay on the same domain as the professor's
own page. Do not follow links to the university's general admissions, department
home, or any page not specifically authored by this professor.
{% endif %}

{% if s2_papers %}
## Papers from Semantic Scholar ({{ s2_papers | length }} pre-fetched)

Select the **5 most relevant** to the applicant's research:
> {{ user.research_interests }}

For each selected paper write:
- `relevance_summary`: exactly 2 sentences — (1) what the paper does, (2) why it
  connects to the applicant's work. Be specific: name the method or finding.
- `relevance_score`: 0–100, how tightly this paper connects to the applicant.

Papers (title | venue | year | abstract excerpt):
{% for p in s2_papers %}
- **{{ p.title }}** | {{ p.venue or "?" }} | {{ p.year or "?" }}
  {% if p.abstract %}{{ p.abstract[:400] }}{% if p.abstract | length > 400 %}…{% endif %}{% endif %}
  {% if p.url %}[{{ p.url }}]{% endif %}
{% endfor %}

{% else %}
No papers were pre-fetched from Semantic Scholar. Extract the 5 most recent
papers visible on the professor's page and include them in the output without
relevance_summary (set to null).
{% endif %}

## What to extract

From all content above (or fetched via WebFetch), extract:

1. **Email address** — their direct contact email.
2. **Lab URL** — their lab or research group website (if different from profile).
3. **Google Scholar URL** — their Scholar profile link if visible.
4. **Research summary** — 3 sentences covering their focus and distinctive work.
5. **Papers** — 5 papers most relevant to the applicant (see criteria above).
6. **Hiring signals** — for each position type, is this professor actively looking?
   - postdoc: true | false | null (null = no explicit signal found)
   - phd: true | false | null
   - master: true | false | null
7. **Contact instructions** — any specific reach-out instructions (e.g., "apply via X website" or "email directly with CV + cover letter"). Quote precisely.
8. **Hiring notes** — key background about the lab and hiring expectations. Format as clear, separate bullets:
   - Role/focus (e.g., "Biomedical signal processing, industry collaboration")
   - Team size and structure (e.g., "25-person lab with 3 postdocs")
   - Preferences (e.g., "Prefers candidates with manufacturing experience")
   - Warnings (e.g., "No response expected to unsolicited emails; apply through department")
9. **Prospective URL** — URL of hiring/openings sub-page if found.

## Output

Return ONLY this JSON (no commentary before or after):

```json
{
  "email": "...",
  "lab_url": "...",
  "scholar_url": "...",
  "summary": "...",
  "papers": [
    {
      "title": "...",
      "venue": "...",
      "year": 2024,
      "url": "... or null",
      "pdf_url": "... or null",
      "s2_id": "... or null",
      "relevance_score": 85,
      "relevance_summary": "Sentence on what the paper does. Sentence on why it connects to the applicant."
    }
  ],
  "prospective_url": "... or null",
  "hiring_signals": {
    "postdoc": true,
    "phd": null,
    "master": false
  },
  "hiring_notes": "... or null",
  "contact_instructions": "... or null",
  "confidence": 0
}
```

Set `confidence` 0-100 reflecting completeness. Use null (not "") for any field
that could not be determined.

**Note on hiring_notes:** These are read by the applicant before reaching out.
Keep each bullet concise and actionable (one sentence per bullet). Avoid vague
generalizations; include specific details like lab size, preferred backgrounds,
or explicit warnings about email response.
