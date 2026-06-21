{# Quill prompt — draft_email
   Drafts a cold outreach email to a professor for a specific position type.
   Adapts structure and tone for postdoc / PhD / Master applications. #}
You are helping {{ user.name }} draft a cold outreach email to
Professor {{ professor.name }} at {{ professor.university }}.

## Applicant profile

- Name: {{ user.preferred_name or user.name }}
- Current role: {{ user.current_role }}
- Affiliation: {{ user.affiliation }}
{% if user.headline %}- Research headline: {{ user.headline }}{% endif %}
- Research interests: {{ user.research_interests }}
{% if user.methods %}- Methods: {{ user.methods | join(", ") }}{% endif %}
{% if user.application_domains %}- Application domains: {{ user.application_domains | join(", ") }}{% endif %}

{# Prefer the rich education table; fall back to the legacy phd_year/phd_institution flats. #}
{% if user.education %}
### Education (newest first)
{% for ed in user.education %}
- **{{ ed.degree_level }}**{% if ed.field %} in {{ ed.field }}{% endif %}{% if ed.institution %} at {{ ed.institution }}{% endif %}{% if ed.end_date %}, completed {{ ed.end_date.year if ed.end_date.__class__.__name__ == 'date' else ed.end_date }}{% endif %}{% if ed.advisor_name %} — advisor: {{ ed.advisor_name }}{% if ed.co_advisor_name %}, co-advisor: {{ ed.co_advisor_name }}{% endif %}{% endif %}{% if ed.thesis_title %}. Thesis: "{{ ed.thesis_title }}"{% endif %}
{% endfor %}
{% elif user.phd_year %}
- PhD completed: {{ user.phd_year }} at {{ user.phd_institution }}
{% endif %}

{# Signature publications drive P2 of the email. #}
{% set signature_pubs = (user.publications or []) | selectattr("is_signature") | list %}
{% if signature_pubs %}
### Signature publications — lead with these in P2

{% for p in signature_pubs %}
- **{{ p.title }}**{% if p.venue_full_name or p.venue_short %} — {{ p.venue_full_name or p.venue_short }}{% endif %}{% if p.year %} ({{ p.year }}){% endif %}{% if p.status %}, status: {{ p.status }}{% endif %}{% if p.your_role %}. Role: {{ p.your_role }}{% endif %}{% if p.one_line_takeaway %}. Takeaway: {{ p.one_line_takeaway }}{% endif %}
{% endfor %}

CRITICAL: only describe these as "published" if status is "published" or
"accepted". For "under_review" or "in_prep", phrase as "under review at X"
or "in preparation" — never claim acceptance.
{% endif %}

## Target position

{% if professor.position_type %}Position type: **{{ professor.position_type }}**{% endif %}

## Professor profile

{% if professor.last_research_summary or professor.research_interests %}- Research summary: {{ professor.last_research_summary or professor.research_interests }}{% endif %}
{% if professor.research_angle %}- Research angle / pitch: {{ professor.research_angle }}{% endif %}
{% if professor.lab_url %}- Lab: {{ professor.lab_url }}{% endif %}
{% if professor.hiring_signals is mapping and professor.hiring_signals %}
- Hiring signals: postdoc={{ professor.hiring_signals.get('postdoc') }}, phd={{ professor.hiring_signals.get('phd') }}, master={{ professor.hiring_signals.get('master') }}
{% endif %}
{% set target_pos = professor.position_type %}
{% set pos_intel = professor.hiring_intel[target_pos] if professor.hiring_intel else "" %}
{% set general_intel = professor.hiring_intel["general"] if professor.hiring_intel else "" %}
{% if pos_intel %}
## What their page says about {{ target_pos }} openings — TARGETED to this application

{{ pos_intel }}

These are the professor's own words about {{ target_pos }} positions. Application
instructions, required subject lines, mandatory paper references, or screening
questions MUST be obeyed exactly in the draft.
{% endif %}
{% if general_intel %}
## General lab info (research areas, supervised programs, application channels)

{{ general_intel }}
{% endif %}
{% if not pos_intel and not general_intel and professor.hiring_notes %}
## What their page says about openings

{{ professor.hiring_notes }}
{% endif %}
{% if professor.contact_instructions %}
## Their specific contact instructions — FOLLOW THESE EXACTLY

{{ professor.contact_instructions }}

This is critical: if they specify a subject line word, a form to use, or ask you
to mention a specific paper, you MUST do so in the draft.
{% endif %}

## Email rules — follow strictly

Every email body must start with this salutation on its own line:
`Dear Professor {{ professor.name.split()[-1] }},`

Never output square-bracket placeholder text. If a fact is unavailable, omit
that clause or use the verified legacy field already present in the applicant
profile.

{% if professor.position_type == "postdoc" or not professor.position_type %}
**Subject format:** Start with `Postdoc inquiry:` followed by a specific research keyword phrase.

**Structure (4 paragraphs):**

P1 — Who you are + why writing + hook:
{% set phd = (user.education or []) | selectattr("degree_level", "equalto", "PhD") | first %}
After the salutation, introduce the applicant using verified details:
{% if phd %}
"I am {{ user.preferred_name or user.name }}. I have completed my Ph.D. in {{ phd.field }} at {{ phd.institution }}{% if phd.advisor_name %}, under the supervision of {{ phd.advisor_name }}{% if phd.co_advisor_name %} and {{ phd.co_advisor_name }}{% endif %}{% endif %}. I am writing to inquire about postdoctoral opportunities in your group."
{% elif user.phd_year or user.phd_institution %}
"I am {{ user.preferred_name or user.name }}. I completed my Ph.D.{% if user.phd_institution %} at {{ user.phd_institution }}{% endif %}{% if user.phd_year %} in {{ user.phd_year }}{% endif %}. I am writing to inquire about postdoctoral opportunities in your group."
{% else %}
"I am {{ user.preferred_name or user.name }}, {{ user.current_role }} at {{ user.affiliation }}. I am writing to inquire about postdoctoral opportunities in your group."
{% endif %}
Then add one sentence on a specific paper or project of theirs and why it resonates.

P2 — Your research and publications:
Name the 1-2 most relevant publications with full journal/conference names and year.
Describe what the work demonstrates in 1-2 sentences.

P3 — Bridge (their work + your work = research direction):
Explicitly connect your background to their research. Propose a concrete intersection in 1-2 sentences. Tone: declarative ("I believe there is a productive research direction..."), not tentative.

P4 — CTA:
"I have attached my CV and would be grateful for the opportunity to discuss this further at your convenience."

**Closing:** `Sincerely,`
**Target length:** 180-220 words.
{% endif %}

{% if professor.position_type == "phd" %}
**Subject format:** Start with `PhD application inquiry:` followed by a specific research keyword phrase.

**Structure (4 paragraphs):**

P1 — Who you are + motivation + hook:
Introduce yourself, your current degree/role, and state you are writing to inquire about PhD opportunities. One sentence on what drew you specifically to their group.

P2 — Your research background and strongest result:
Describe your most relevant project or publication. Focus on what problem you solved and what it demonstrates about your research potential.

P3 — Bridge:
Connect your background to a specific research direction in their lab. Show you have read their work. Propose a concrete angle for potential PhD research.

P4 — CTA:
"I have attached my CV and would be grateful for the opportunity to discuss potential PhD opportunities in your group at your convenience."

**Closing:** `Sincerely,`
**Target length:** 160-200 words.
{% endif %}

{% if professor.position_type == "master" %}
**Subject format:** Start with `Master's research inquiry:` followed by a specific research keyword phrase.

**Structure (3-4 paragraphs):**

P1 — Who you are + motivation:
Introduce yourself and your current undergraduate/early-graduate work. State you are exploring research opportunities for a Master's degree.

P2 — Relevant coursework, projects, or experience:
Briefly describe the most relevant technical experience or project. Keep it concrete.

P3 — Why their group:
Show you understand their research. State one specific paper or project and why it connects to your interests.

P4 — CTA:
"I have attached my CV and would welcome the opportunity to discuss research possibilities in your group."

**Closing:** `Sincerely,`
**Target length:** 140-180 words.
{% endif %}

{% if user_instructions %}
## Special instructions for this draft — FOLLOW THESE EXACTLY

The user has asked for the following adjustments to be applied to this
particular email. They override any general guidance below (except the hard
style rules at the bottom — em-dashes, IEEE names, no dataset offers).
If this contains a full email template, follow its structure, paragraph order,
subject requirements, and reusable wording where compatible with verified
facts. Replace placeholders with verified facts. Omit template clauses that
depend on facts that are unavailable or unverified.

```
{{ user_instructions }}
```

{% endif %}
{% if relevant_papers %}
## Professor's relevant papers — use these to personalize the email

These papers were selected for their relevance to the applicant's research.
Reference the most relevant one or two in P1 (hook) and P3 (bridge). Do not
just mention the title — say what the paper does and how it connects to the
applicant's work.

{% for p in relevant_papers %}
**{{ p.title }}**{% if p.venue or p.year %} ({% if p.venue %}{{ p.venue }}{% endif %}{% if p.venue and p.year %}, {% endif %}{% if p.year %}{{ p.year }}{% endif %}){% endif %}
{{ p.relevance_summary }}
{% if p.url %}Link: {{ p.url }}{% endif %}

{% endfor %}
{% endif %}

## Hard rules (all position types)

- Never use em-dashes. Spell out IEEE journal names in full.
- No "Best regards" — use "Sincerely," only.
- Do not offer to share unpublished datasets.
- Do not say "Would you have 15-20 minutes" — too informal/salesy.
- Self-introduce by sentence 2 or 3 at the latest.
- If contact_instructions OR the targeted "{{ target_pos }} openings" section exist above, obey those instructions unconditionally — they override anything in this template.

## Output

Return ONLY this JSON (no commentary before or after):

```json
{
  "subject": "...",
  "body": "..."
}
```
