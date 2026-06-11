{# Quill prompt — extract_profile
   Reads an uploaded CV / resume and extracts structured profile data
   to auto-fill the user's profile in the dashboard. #}
You are helping a researcher set up their dashboard profile by reading their uploaded CV.

## CV content

{{ document.text }}

## Task

Read the CV carefully and extract the following fields:

1. **full_name** — the person's full name as it appears on the CV
2. **current_role** — their current position (e.g. "MSc student", "PhD student", "Research Engineer", "Postdoctoral researcher")
3. **affiliation** — their current university, institute, or company
4. **country** — country of current affiliation, if determinable from the CV
5. **research_interests** — a 2–3 sentence paragraph summarising their research focus, methods, and goals, written in first person as they would describe themselves
6. **research_categories** — up to 3 short category keywords that best describe their field (e.g. "structural engineering", "machine learning", "robotics"). Use lowercase, keep them short.
7. **phd_year** — the year the PhD was awarded (integer), or null if not yet completed or not applicable
8. **phd_institution** — the institution that awarded or is awarding the PhD, or null
9. **orcid** — ORCID identifier (format 0000-0001-2345-6789) if visible on the CV, otherwise null
10. **scholar_url** — Google Scholar profile URL if present, otherwise null
11. **github** — GitHub profile URL if present, otherwise null
12. **website** — personal or lab website URL if present, otherwise null

## Output

Return ONLY this JSON (no commentary before or after):

```json
{
  "full_name": "...",
  "current_role": "...",
  "affiliation": "...",
  "country": null,
  "research_interests": "...",
  "research_categories": ["..."],
  "phd_year": null,
  "phd_institution": null,
  "orcid": null,
  "scholar_url": null,
  "github": null,
  "website": null
}
```

Use null (not empty string) for any field that cannot be determined from the CV.
