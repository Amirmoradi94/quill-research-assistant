{# Quill prompt template — research_professor (Phase 1 will Jinja-render this) #}
You are helping {{ user.name }}, a {{ user.current_role }} at
{{ user.affiliation }}, researching {{ user.research_interests }}.

Task: research Professor {{ professor.name }} at {{ professor.university }}.

{% if professor.profile_url -%}
Their profile is at {{ professor.profile_url }}.
{%- else -%}
You'll need to find their profile via web search.
{%- endif %}

Use WebFetch to retrieve their lab page and Google Scholar (if found).
Extract:
- email
- lab URL
- 3-sentence research summary
- top 5 recent papers (title, venue, year)
- whether they're explicitly hiring postdocs

Return JSON:
{
  "email": "...",
  "lab_url": "...",
  "summary": "...",
  "recent_papers": [{ "title": "...", "venue": "...", "year": 2025 }],
  "hiring_postdocs": true | false | null,
  "confidence": 0
}
