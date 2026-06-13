{# Quill prompt — discover_professors
   Searches the web for professors whose research closely matches the user's
   profile and returns a ranked JSON list of potential supervisors. #}
You are helping **{{ user.name }}**, a {{ user.current_role }} at {{ user.affiliation }},
find faculty to contact for **{{ position_type or "PhD" }}** positions.

---

## Applicant's research profile

{% if focus_override %}
**Custom focus (replaces profile):**
{{ focus_override }}
{% else %}
{{ user.research_interests }}
{% if focus_supplement %}

**Additional focus for this search:**
{{ focus_supplement }}
{% endif %}
{% endif %}

{% if user.research_categories %}
Research categories: {{ user.research_categories | join(', ') }}
{% endif %}

---

## Search parameters

**Position type:** {{ position_type or "phd" }}
{% if discovery_batch and discovery_total_batches %}
**Discovery batch:** {{ discovery_batch }} of {{ discovery_total_batches }}
**Overall target:** {{ discovery_total_target }} professors across all batches
**This batch target:** {{ count or 10 }} new professors
{% endif %}
{% if start_date %}**Target start date:** {{ start_date }}{% endif %}
{% if duration and duration != "any" %}**Duration:** {{ duration }} (postdoc){% endif %}
{% if target_countries %}**Preferred countries / regions:** {{ target_countries }}{% endif %}
{% if exclude_countries %}**Exclude countries:** {{ exclude_countries }}{% endif %}
{% if language_english_only %}**Language:** English instruction only{% endif %}
{% if prof_ranks %}**Academic rank filter:** {{ prof_ranks }} professors only{% endif %}
{% if pub_recency_years %}**Publication recency:** must have published within the last {{ pub_recency_years }} year(s){% endif %}
{% if hiring_signals_only %}**Hiring filter:** ONLY include professors with clear active hiring signals{% endif %}
{% if funding_type and funding_type != "any" %}**Funding type required:** {{ funding_type }}{% endif %}
{% if min_stipend_hint %}**Stipend hint:** {{ min_stipend_hint }}{% endif %}
{% if require_email %}**Email required:** only include professors whose email is findable{% endif %}
{% if prefer_international_lab %}**Lab preference:** prefer labs known to have international students{% endif %}
**Max per university:** {% if max_per_university and max_per_university > 0 %}{{ max_per_university }}{% else %}no limit (include every relevant professor at each university){% endif %}
{% if target_departments %}**Target departments:** {{ target_departments }} — restrict to professors affiliated with these departments / schools / institutes{% endif %}

{% if exclude_universities %}
## Universities to skip (already in pipeline)
{{ exclude_universities }}
{% endif %}

{% if exclude_disciplines %}
## Disciplines to exclude
{{ exclude_disciplines }}
{% endif %}

{% if skip_professor_ids %}
## Professor IDs to skip (previously dismissed)
{{ skip_professor_ids }}
{% endif %}

{% if exclude_candidates %}
## Professors already found or already in the pipeline
Do not return these professors again. Use this list to move to adjacent labs,
different universities, and less obvious matches in this batch.

{{ exclude_candidates }}
{% endif %}

---

## Task

Find **{{ count or 10 }}** new professors worldwide whose research is the strongest match for this profile.
{% if discovery_batch and discovery_total_batches %}
This is one batch in a larger discovery pass, not the final universe of possible matches. If the obvious matches are already excluded, broaden to adjacent universities, labs, departments, and keywords while preserving match quality.
{% endif %}

For each candidate:
1. Use WebSearch to locate their faculty page: search `"[name] [university] professor [field]"`
2. Fetch their profile/lab page to confirm: active publications (within recency limit), lab members, ongoing projects
3. Check for hiring signals: openings page, "prospective students" section, recent PhD graduates, lab size growth
4. Confirm affiliation with an R1 or equivalent research university
{% if funding_type and funding_type != "any" %}5. Look for funding information matching "{{ funding_type }}"{% endif %}
{% if language_english_only %}5. Verify the university offers programs in English{% endif %}

**Search guidelines:**
- Prioritise thematic overlap — not just keyword matching or field name
{% if max_per_university and max_per_university > 0 %}- No more than {{ max_per_university }} professors from the same university{% else %}- No cap on professors per university — include every relevant match{% endif %}
{% if target_departments %}- Strictly filter by target departments: {{ target_departments }}. Skip professors outside these departments even if their research overlaps.{% endif %}
- Prefer professors who have supervised students in the target position type ({{ position_type or "phd" }})
- Interdisciplinary profiles → cast a wider net across adjacent departments
- Be honest: if you cannot confirm a match or the page is unavailable, skip

---

## Output

Return ONLY valid JSON — no commentary, no markdown fences around the JSON:

{
  "professors": [
    {
      "name": "...",
      "university": "...",
      "profile_url": "... or null",
      "research_angle": "1–2 sentences: what they work on and exactly why it matches this applicant",
      "research_category": "primary category keyword (lowercase, short)",
      "position_type": "{{ position_type or 'phd' }}",
      "match_score": 85,
      "hiring_signals": true
    }
  ]
}

Field notes:
- `match_score` 0–100: how well research aligns with the applicant's profile
- `hiring_signals`: true = clearly accepting students, false = closed, null = unclear
- Sort by match_score descending
