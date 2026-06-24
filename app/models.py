from datetime import datetime
from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from .database import Base


# ───────────────────────────────────────────────────────────────────
# Singletons (one row each)
# ───────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)

    # Identity
    name = Column(String, nullable=False, default="")          # legal name
    preferred_name = Column(String, nullable=True)
    pronouns = Column(String, nullable=True)
    headshot_url = Column(String, nullable=True)

    # Contact
    email = Column(String, nullable=True)                      # primary
    email_secondary = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    city = Column(String, nullable=True)
    country = Column(String, nullable=True)
    nationality = Column(String, nullable=True)
    languages = Column(JSON, nullable=True)                    # [{"lang":"English","level":"native"}]

    # Online presence
    orcid = Column(String, nullable=True)
    scholar_url = Column(String, nullable=True)
    github = Column(String, nullable=True)
    linkedin = Column(String, nullable=True)
    website = Column(String, nullable=True)
    twitter = Column(String, nullable=True)

    # Current role (snapshot of "latest" — long history lives in user_experience)
    current_role = Column(String, nullable=True)
    affiliation = Column(String, nullable=True)

    # Application target — drives discovery filters & prompt branching
    target_position_type = Column(String, nullable=True)       # postdoc|phd|master
    target_start_date = Column(Date, nullable=True)
    earliest_available_date = Column(Date, nullable=True)
    target_countries = Column(JSON, nullable=True)             # ["CA","US"]
    target_universities_preferred = Column(JSON, nullable=True)
    excluded_institutions = Column(JSON, nullable=True)
    funding_status = Column(String, nullable=True)             # have_scholarship|need_funded|self_funded|flexible
    work_authorization = Column(JSON, nullable=True)           # {"CA":"PR","US":"needs_visa"}
    commitment_length = Column(String, nullable=True)          # "1y"|"2y"|"open"

    # Research profile (matching engine inputs)
    headline = Column(String, nullable=True)                   # 1-sentence pitch
    research_interests = Column(Text, nullable=True)           # paragraph
    research_categories = Column(JSON, nullable=True)          # category slugs; matches --color-cat-*
    methods = Column(JSON, nullable=True)
    application_domains = Column(JSON, nullable=True)
    tools_frameworks = Column(JSON, nullable=True)
    datasets_used = Column(JSON, nullable=True)
    datasets_created = Column(JSON, nullable=True)             # [{"name":"...","status":"private"}]

    # Skills (scalars — repeatable items use the related tables below)
    programming_languages = Column(JSON, nullable=True)
    certifications = Column(JSON, nullable=True)
    reviewing_venues = Column(JSON, nullable=True)
    teaching_summary = Column(Text, nullable=True)

    # Legacy snapshot — kept for backwards-compat with current draft_email.md.
    # Authoritative data now lives in user_education.
    phd_year = Column(Integer, nullable=True)
    phd_institution = Column(String, nullable=True)

    # Linked documents (FK to documents.id; nullable so we don't block bootstrap)
    cv_doc_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    research_statement_doc_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    transcript_doc_ids = Column(JSON, nullable=True)           # [id, id, ...]
    sample_paper_doc_ids = Column(JSON, nullable=True)

    # Provenance — per-field extraction metadata.
    # Shape: {"field_name": {"source":"cv","confidence":0.9,"extracted_at":"...","verified_by_user":false}}
    field_provenance = Column(JSON, nullable=True)
    cv_last_extracted_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Repeatable items
    education = relationship("UserEducation", cascade="all, delete-orphan", order_by="UserEducation.end_date.desc()")
    publications = relationship("UserPublication", cascade="all, delete-orphan", order_by="UserPublication.year.desc()")
    experience = relationship("UserExperience", cascade="all, delete-orphan", order_by="UserExperience.end_date.desc()")
    awards = relationship("UserAward", cascade="all, delete-orphan", order_by="UserAward.year.desc()")
    references = relationship("UserReference", cascade="all, delete-orphan")


class UserEducation(Base):
    __tablename__ = "user_education"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    degree_level = Column(String, nullable=False)              # PhD|MSc|MEng|BSc|...
    field = Column(String, nullable=True)
    institution = Column(String, nullable=True)
    department = Column(String, nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    is_current = Column(Boolean, default=False)
    gpa = Column(Float, nullable=True)
    gpa_scale = Column(Float, nullable=True)                   # 4.0 or 5.0 etc.
    honors = Column(String, nullable=True)
    advisor_name = Column(String, nullable=True)
    advisor_title = Column(String, nullable=True)
    co_advisor_name = Column(String, nullable=True)
    thesis_title = Column(String, nullable=True)
    thesis_abstract = Column(Text, nullable=True)
    key_courses = Column(JSON, nullable=True)                  # [{"name":"...","grade":"A","year":2024}]
    transcript_doc_id = Column(Integer, ForeignKey("documents.id"), nullable=True)
    order_idx = Column(Integer, default=0)


class UserPublication(Base):
    __tablename__ = "user_publications"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    title = Column(Text, nullable=False)
    authors = Column(Text, nullable=True)                      # comma-separated, original order
    venue_full_name = Column(String, nullable=True)            # full name — house rule
    venue_short = Column(String, nullable=True)
    year = Column(Integer, nullable=True, index=True)
    type = Column(String, nullable=True)                       # journal|conference|workshop|preprint|thesis
    status = Column(String, nullable=True, default="published") # published|under_review|in_prep|accepted
    doi = Column(String, nullable=True)
    url = Column(String, nullable=True)
    pdf_url = Column(String, nullable=True)
    citation_count = Column(Integer, nullable=True)
    your_role = Column(String, nullable=True)                  # "first author and lead designer"
    abstract = Column(Text, nullable=True)
    one_line_takeaway = Column(Text, nullable=True)            # the sentence dropped into P2/P3 of emails
    is_signature = Column(Boolean, default=False, index=True)  # surface preferentially
    order_idx = Column(Integer, default=0)


class UserExperience(Base):
    __tablename__ = "user_experience"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    title = Column(String, nullable=False)
    employer = Column(String, nullable=True)
    lab_or_group = Column(String, nullable=True)
    supervisor = Column(String, nullable=True)
    location = Column(String, nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    is_current = Column(Boolean, default=False)
    bullets = Column(JSON, nullable=True)                      # ["...", "..."]
    tech_used = Column(JSON, nullable=True)
    order_idx = Column(Integer, default=0)


class UserAward(Base):
    __tablename__ = "user_awards"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    name = Column(String, nullable=False)
    granting_body = Column(String, nullable=True)
    amount = Column(Float, nullable=True)
    currency = Column(String, nullable=True, default="USD")
    year = Column(Integer, nullable=True, index=True)
    type = Column(String, nullable=True)                       # scholarship|fellowship|grant|best_paper|competition
    notes = Column(Text, nullable=True)
    order_idx = Column(Integer, default=0)


class UserReference(Base):
    __tablename__ = "user_references"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    name = Column(String, nullable=False)
    title = Column(String, nullable=True)
    institution = Column(String, nullable=True)
    email = Column(String, nullable=True)
    relationship_type = Column(String, nullable=True)          # "PhD advisor", "MSc co-supervisor", ...
    years_known = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    order_idx = Column(Integer, default=0)


class Settings(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True)
    ai_provider = Column(String, nullable=False, default="openrouter_api")
    claude_cli_path = Column(String, nullable=True)
    codex_cli_path = Column(String, nullable=True)
    anthropic_api_key = Column(String, nullable=True)
    openai_api_key = Column(String, nullable=True)
    openrouter_api_key = Column(String, nullable=True)
    openrouter_model = Column(String, nullable=False, default="z-ai/glm-5.2")
    default_provider_per_workflow = Column(JSON, nullable=True)
    email_tone_rules = Column(Text, nullable=True)
    daily_cost_cap_usd = Column(Float, nullable=False, default=5.0)
    ui_density = Column(String, nullable=False, default="comfortable")
    batch_defaults = Column(JSON, nullable=True)

    # Gmail SMTP — credentials for sending drafts directly. The app password is
    # encrypted at rest with Fernet keyed off the SECRET_KEY env var (or a
    # generated key persisted to data/.smtp_key on first boot).
    gmail_address = Column(String, nullable=True)
    gmail_app_password_encrypted = Column(String, nullable=True)
    gmail_send_name = Column(String, nullable=True)
    gmail_last_verified_at = Column(DateTime, nullable=True)

    # Auto-poll Gmail inbox for replies. When enabled, a background loop runs
    # check_replies() every reply_check_interval_hours.
    reply_check_enabled = Column(Boolean, nullable=False, default=False)
    reply_check_interval_hours = Column(Integer, nullable=False, default=4)
    reply_check_last_run_at = Column(DateTime, nullable=True)
    reply_check_last_status = Column(JSON, nullable=True)
    reply_check_last_error = Column(Text, nullable=True)


# ───────────────────────────────────────────────────────────────────
# Core entities
# ───────────────────────────────────────────────────────────────────
class Professor(Base):
    __tablename__ = "professors"

    id = Column(Integer, primary_key=True)
    number = Column(Integer, index=True)
    name = Column(String, nullable=False)
    university = Column(String, index=True)
    dept_lab = Column(String, default="")
    tier = Column(String, index=True, default="T3")
    status = Column(String, index=True, default="drafting")
    date_sent = Column(Date, nullable=True)
    email = Column(String, default="")
    research_angle = Column(String, default="")
    notes = Column(Text, default="")
    priority = Column(Integer, default=0)
    profile_url = Column(String, default="")
    research_interests = Column(Text, default="")
    research_category = Column(String, default="")

    # ── v1 redesign extensions ──
    scholar_url = Column(String, nullable=True)
    twitter = Column(String, nullable=True)
    lab_url = Column(String, nullable=True)
    last_research_summary = Column(Text, nullable=True)
    research_summary_at = Column(DateTime, nullable=True)
    auto_filled_at = Column(DateTime, nullable=True)
    source = Column(String, nullable=False, default="manual")
    is_suggested = Column(Boolean, nullable=False, default=False)
    dismissed_at = Column(DateTime, nullable=True)
    match_score = Column(Integer, nullable=True)

    # ── position targeting + scraped hiring intelligence ──
    position_type = Column(String, nullable=True)          # postdoc | phd | master
    prospective_url = Column(String, nullable=True)        # URL of join/openings sub-page
    hiring_signals = Column(JSON, nullable=True)           # {"postdoc": true, "phd": null, "master": false}
    hiring_notes = Column(Text, nullable=True)             # raw text from prospective/openings pages
    hiring_intel = Column(JSON, nullable=True)             # structured: {"postdoc": "...", "phd": "...", "master": "...", "general": "..."}
    contact_instructions = Column(Text, nullable=True)     # specific reach-out instructions from their page
    profile_scraped_at = Column(DateTime, nullable=True)   # timestamp of last deep scrape

    # ── relevance scoring (replaces tier) ──
    relevance_score = Column(Integer, nullable=True)       # 0-100 calculated match score
    relevance_breakdown = Column(JSON, nullable=True)      # component contributions for transparency
    relevance_scored_at = Column(DateTime, nullable=True)  # last time the score was computed

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    activities = relationship(
        "Activity", back_populates="professor", cascade="all, delete-orphan"
    )
    drafts = relationship(
        "EmailDraft", back_populates="professor", cascade="all, delete-orphan"
    )
    applications = relationship(
        "Application", back_populates="professor", cascade="all, delete-orphan"
    )
    papers = relationship(
        "ProfessorPaper", back_populates="professor", cascade="all, delete-orphan",
        order_by="ProfessorPaper.year.desc()",
    )


# ───────────────────────────────────────────────────────────────────
# Deterministic discovery crawl state
# ───────────────────────────────────────────────────────────────────
class DiscoveryRun(Base):
    """One exhaustive discovery pass across target countries/universities."""
    __tablename__ = "discovery_runs"

    id = Column(Integer, primary_key=True)
    status = Column(String, nullable=False, default="queued", index=True)  # queued|running|done|failed|cancelled
    phase = Column(String, nullable=False, default="schema")               # universities|departments|pages|candidates|scoring
    position_type = Column(String, nullable=True)
    target_countries = Column(JSON, nullable=True)
    target_departments = Column(JSON, nullable=True)
    filters = Column(JSON, nullable=True)

    universities_total = Column(Integer, nullable=False, default=0)
    universities_checked = Column(Integer, nullable=False, default=0)
    departments_found = Column(Integer, nullable=False, default=0)
    directory_pages_found = Column(Integer, nullable=False, default=0)
    pages_crawled = Column(Integer, nullable=False, default=0)
    candidates_extracted = Column(Integer, nullable=False, default=0)
    candidates_verified = Column(Integer, nullable=False, default=0)
    candidates_rejected = Column(Integer, nullable=False, default=0)
    professors_saved = Column(Integer, nullable=False, default=0)
    failures = Column(Integer, nullable=False, default=0)

    summary = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    universities = relationship("DiscoveryUniversity", back_populates="run", cascade="all, delete-orphan")
    departments = relationship("DiscoveryDepartment", back_populates="run", cascade="all, delete-orphan")
    pages = relationship("DiscoveryPage", back_populates="run", cascade="all, delete-orphan")
    candidates = relationship("DiscoveryCandidate", back_populates="run", cascade="all, delete-orphan")
    logs = relationship("DiscoveryLog", back_populates="run", cascade="all, delete-orphan")


class DiscoveryUniversity(Base):
    """University candidate discovered for a crawl run."""
    __tablename__ = "discovery_universities"
    __table_args__ = (
        UniqueConstraint("run_id", "normalized_name", "country", name="uq_discovery_university_run_name_country"),
    )

    id = Column(Integer, primary_key=True)
    run_id = Column(Integer, ForeignKey("discovery_runs.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    normalized_name = Column(String, nullable=False, index=True)
    country = Column(String, nullable=False, index=True)
    country_code = Column(String, nullable=True, index=True)
    region = Column(String, nullable=True)
    official_domain = Column(String, nullable=True, index=True)
    official_url = Column(String, nullable=True)
    source = Column(String, nullable=True)                   # ror|openalex|search|manual
    source_url = Column(String, nullable=True)
    source_confidence = Column(Float, nullable=True)
    status = Column(String, nullable=False, default="pending", index=True)  # pending|checked|failed|skipped
    error_message = Column(Text, nullable=True)
    discovered_at = Column(DateTime, default=datetime.utcnow)
    checked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    run = relationship("DiscoveryRun", back_populates="universities")
    departments = relationship("DiscoveryDepartment", back_populates="university", cascade="all, delete-orphan")
    pages = relationship("DiscoveryPage", back_populates="university", cascade="all, delete-orphan")
    candidates = relationship("DiscoveryCandidate", back_populates="university")


class DiscoveryDepartment(Base):
    """Relevant department, school, institute, or research group page seed."""
    __tablename__ = "discovery_departments"
    __table_args__ = (
        UniqueConstraint("run_id", "university_id", "normalized_name", name="uq_discovery_department_run_university_name"),
    )

    id = Column(Integer, primary_key=True)
    run_id = Column(Integer, ForeignKey("discovery_runs.id"), nullable=False, index=True)
    university_id = Column(Integer, ForeignKey("discovery_universities.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    normalized_name = Column(String, nullable=False, index=True)
    school = Column(String, nullable=True)
    url = Column(String, nullable=True)
    domain = Column(String, nullable=True, index=True)
    source = Column(String, nullable=True)                   # search|sitemap|university_page|manual
    relevance_keywords = Column(JSON, nullable=True)
    status = Column(String, nullable=False, default="pending", index=True)  # pending|queued|crawled|failed|skipped
    error_message = Column(Text, nullable=True)
    discovered_at = Column(DateTime, default=datetime.utcnow)
    crawled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    run = relationship("DiscoveryRun", back_populates="departments")
    university = relationship("DiscoveryUniversity", back_populates="departments")
    pages = relationship("DiscoveryPage", back_populates="department", cascade="all, delete-orphan")
    candidates = relationship("DiscoveryCandidate", back_populates="department")


class DiscoveryPage(Base):
    """A crawlable page URL with fetch/extraction state."""
    __tablename__ = "discovery_pages"
    __table_args__ = (
        UniqueConstraint("run_id", "normalized_url", name="uq_discovery_page_run_url"),
    )

    id = Column(Integer, primary_key=True)
    run_id = Column(Integer, ForeignKey("discovery_runs.id"), nullable=False, index=True)
    university_id = Column(Integer, ForeignKey("discovery_universities.id"), nullable=True, index=True)
    department_id = Column(Integer, ForeignKey("discovery_departments.id"), nullable=True, index=True)
    url = Column(Text, nullable=False)
    normalized_url = Column(Text, nullable=False)
    final_url = Column(Text, nullable=True)
    page_type = Column(String, nullable=False, default="unknown", index=True)  # department|faculty_directory|lab|profile|sitemap|unknown
    status = Column(String, nullable=False, default="pending", index=True)    # pending|crawled|failed|skipped
    depth = Column(Integer, nullable=False, default=0)
    fetcher = Column(String, nullable=True)                  # httpx|scrapling|playwright|crawl4ai
    http_status = Column(Integer, nullable=True)
    content_hash = Column(String, nullable=True, index=True)
    title = Column(String, nullable=True)
    discovered_from_url = Column(Text, nullable=True)
    extracted_count = Column(Integer, nullable=False, default=0)
    error_message = Column(Text, nullable=True)
    first_seen_at = Column(DateTime, default=datetime.utcnow)
    last_crawled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    run = relationship("DiscoveryRun", back_populates="pages")
    university = relationship("DiscoveryUniversity", back_populates="pages")
    department = relationship("DiscoveryDepartment", back_populates="pages")
    candidates = relationship("DiscoveryCandidate", back_populates="source_page")
    evidence = relationship("DiscoveryEvidence", back_populates="page")


class DiscoveryCandidate(Base):
    """Extracted professor candidate before/after verification and scoring."""
    __tablename__ = "discovery_candidates"
    __table_args__ = (
        UniqueConstraint("run_id", "normalized_name", "university_id", name="uq_discovery_candidate_run_name_university"),
    )

    id = Column(Integer, primary_key=True)
    run_id = Column(Integer, ForeignKey("discovery_runs.id"), nullable=False, index=True)
    university_id = Column(Integer, ForeignKey("discovery_universities.id"), nullable=True, index=True)
    department_id = Column(Integer, ForeignKey("discovery_departments.id"), nullable=True, index=True)
    source_page_id = Column(Integer, ForeignKey("discovery_pages.id"), nullable=True, index=True)
    professor_id = Column(Integer, ForeignKey("professors.id"), nullable=True, index=True)

    name = Column(String, nullable=False)
    normalized_name = Column(String, nullable=False, index=True)
    title = Column(String, nullable=True)
    rank = Column(String, nullable=True, index=True)
    university_name = Column(String, nullable=True)
    country = Column(String, nullable=True, index=True)
    dept_lab = Column(String, nullable=True)
    email = Column(String, nullable=True)
    profile_url = Column(Text, nullable=True)
    lab_url = Column(Text, nullable=True)
    scholar_url = Column(Text, nullable=True)
    research_text = Column(Text, nullable=True)
    evidence_summary = Column(Text, nullable=True)
    raw_payload = Column(JSON, nullable=True)

    extraction_confidence = Column(Float, nullable=True)
    verification_status = Column(String, nullable=False, default="pending", index=True)  # pending|verified|rejected|duplicate
    rejection_reason = Column(Text, nullable=True)
    match_score = Column(Integer, nullable=True, index=True)
    matched_reasons = Column(JSON, nullable=True)
    scored_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    run = relationship("DiscoveryRun", back_populates="candidates")
    university = relationship("DiscoveryUniversity", back_populates="candidates")
    department = relationship("DiscoveryDepartment", back_populates="candidates")
    source_page = relationship("DiscoveryPage", back_populates="candidates")
    professor = relationship("Professor")
    evidence = relationship("DiscoveryEvidence", back_populates="candidate", cascade="all, delete-orphan")


class DiscoveryEvidence(Base):
    """Small evidence snippets/URLs supporting a candidate or crawl decision."""
    __tablename__ = "discovery_evidence"

    id = Column(Integer, primary_key=True)
    candidate_id = Column(Integer, ForeignKey("discovery_candidates.id"), nullable=True, index=True)
    page_id = Column(Integer, ForeignKey("discovery_pages.id"), nullable=True, index=True)
    evidence_type = Column(String, nullable=False, index=True)  # profile|email|research|rank|department|country|rejection
    url = Column(Text, nullable=True)
    quote = Column(Text, nullable=True)
    confidence = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    candidate = relationship("DiscoveryCandidate", back_populates="evidence")
    page = relationship("DiscoveryPage", back_populates="evidence")


class DiscoveryLog(Base):
    """Append-only crawler log entries for coverage and debugging."""
    __tablename__ = "discovery_logs"

    id = Column(Integer, primary_key=True)
    run_id = Column(Integer, ForeignKey("discovery_runs.id"), nullable=False, index=True)
    level = Column(String, nullable=False, default="info", index=True)  # debug|info|warning|error
    stage = Column(String, nullable=True, index=True)
    message = Column(Text, nullable=False)
    payload = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    run = relationship("DiscoveryRun", back_populates="logs")


class EmailDraft(Base):
    __tablename__ = "email_drafts"

    id = Column(Integer, primary_key=True)
    professor_id = Column(Integer, ForeignKey("professors.id"), index=True, nullable=False)
    subject = Column(String, default="")
    body = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # ── v1 redesign extensions ──
    ai_generated = Column(Boolean, nullable=False, default=False)
    ai_run_id = Column(Integer, ForeignKey("ai_runs.id"), nullable=True)
    version = Column(Integer, nullable=False, default=1)
    sent_via = Column(String, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    sent_message_id = Column(String, nullable=True)          # RFC 5322 Message-ID we generated
    send_error = Column(Text, nullable=True)                 # last SMTP error, cleared on success
    skipped_at = Column(DateTime, nullable=True)
    is_backup = Column(Boolean, nullable=False, default=False, index=True)
    # Per-draft attachments (document.id list). NULL means fall back to
    # user.cv_doc_id at send time. Empty list means "send with no attachments".
    attachment_doc_ids = Column(JSON, nullable=True)

    professor = relationship("Professor", back_populates="drafts")
    ai_run = relationship("AIRun", foreign_keys=[ai_run_id])
    replies = relationship("EmailReply", back_populates="draft", cascade="all, delete-orphan")


class EmailReply(Base):
    """Inbound reply to a sent EmailDraft, pulled from Gmail via IMAP."""
    __tablename__ = "email_replies"

    id = Column(Integer, primary_key=True)
    draft_id = Column(Integer, ForeignKey("email_drafts.id"), index=True, nullable=False)
    professor_id = Column(Integer, ForeignKey("professors.id"), index=True, nullable=False)
    received_at = Column(DateTime, nullable=False, index=True)
    from_email = Column(String, nullable=True)
    from_name = Column(String, nullable=True)
    subject = Column(String, nullable=True)
    snippet = Column(Text, nullable=True)
    body = Column(Text, nullable=True)
    message_id = Column(String, unique=True, nullable=True, index=True)
    in_reply_to = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # ── reply management (Sent page) ──
    read_at = Column(DateTime, nullable=True)
    dismissed_at = Column(DateTime, nullable=True)
    response_draft = Column(Text, nullable=True)          # the reply we compose back
    response_subject = Column(String, nullable=True)
    response_sent_at = Column(DateTime, nullable=True)
    response_message_id = Column(String, nullable=True)   # Message-ID of our outbound reply

    # ── meeting detection (nudges the Interview Prep feature) ──
    meeting_request = Column(Boolean, nullable=True)      # heuristic: reply looks like a meeting invite
    meeting_intent_at = Column(DateTime, nullable=True)   # when the heuristic flagged it

    draft = relationship("EmailDraft", back_populates="replies")


class InterviewPrep(Base):
    """Generated prep materials for a meeting with a professor. One per professor."""
    __tablename__ = "interview_prep"

    id = Column(Integer, primary_key=True)
    professor_id = Column(Integer, ForeignKey("professors.id"), index=True, nullable=False)
    reply_id = Column(Integer, ForeignKey("email_replies.id"), nullable=True)

    position_type = Column(String, nullable=True)          # postdoc|phd|master (snapshot)
    meeting_format = Column(String, nullable=False, default="formal_interview")  # informal_chat|formal_interview|job_talk|panel
    meeting_at = Column(DateTime, nullable=True)
    meeting_notes = Column(Text, nullable=True)            # platform, timezone, links

    briefing = Column(Text, nullable=True)
    fit_analysis = Column(Text, nullable=True)
    talking_points = Column(JSON, nullable=True)           # ["...", "..."]
    likely_questions = Column(JSON, nullable=True)         # [{"question":"...","draft_answer":"...","category":"..."}]
    questions_to_ask = Column(JSON, nullable=True)         # ["...", "..."]
    logistics = Column(JSON, nullable=True)                # [{"item":"...","done":false}]

    status = Column(String, nullable=False, default="draft")  # draft|ready|completed
    ai_run_id = Column(Integer, ForeignKey("ai_runs.id"), nullable=True)
    generated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    professor = relationship("Professor")


class MockInterview(Base):
    """A practice interview session — Quill role-plays the professor."""
    __tablename__ = "mock_interview"

    id = Column(Integer, primary_key=True)
    prep_id = Column(Integer, ForeignKey("interview_prep.id"), index=True, nullable=False)
    transcript = Column(JSON, nullable=True)               # [{"role":"professor|applicant|feedback","text":"...","at":"..."}]
    status = Column(String, nullable=False, default="active")  # active|completed
    summary = Column(Text, nullable=True)                  # end-of-session feedback
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class Grant(Base):
    """Renamed from Fellowship. Same `id` column, table is now `grants`."""
    __tablename__ = "grants"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    deadline = Column(String, default="")
    amount = Column(String, default="")
    eligibility = Column(Text, default="")
    status = Column(String, default="pending")
    notes = Column(Text, default="")
    url = Column(String, default="")

    # ── v1 redesign extensions ──
    source = Column(String, nullable=False, default="manual")
    match_score = Column(Integer, nullable=True)
    matched_reasons = Column(JSON, nullable=True)
    region = Column(String, nullable=True)
    discipline_tags = Column(JSON, nullable=True)


class Activity(Base):
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True)
    date = Column(Date, default=datetime.utcnow)
    action = Column(String, nullable=False)
    detail = Column(Text, default="")
    professor_id = Column(Integer, ForeignKey("professors.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    professor = relationship("Professor", back_populates="activities")


# ───────────────────────────────────────────────────────────────────
# Documents & publications
# ───────────────────────────────────────────────────────────────────
class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True)
    kind = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    file_path = Column(String, nullable=True)
    text = Column(Text, nullable=True)
    extracted_json = Column(JSON, nullable=True)
    is_default = Column(Boolean, nullable=False, default=False)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Publication(Base):
    __tablename__ = "publications"

    id = Column(Integer, primary_key=True)
    title = Column(String, nullable=False)
    venue = Column(String, nullable=True)
    year = Column(Integer, nullable=True)
    authors = Column(JSON, nullable=True)
    my_author_order = Column(Integer, nullable=True)
    status = Column(String, nullable=False, default="published")
    doi = Column(String, nullable=True)
    url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ───────────────────────────────────────────────────────────────────
# AI runs
# ───────────────────────────────────────────────────────────────────
class AIRun(Base):
    __tablename__ = "ai_runs"

    id = Column(Integer, primary_key=True)
    workflow = Column(String, nullable=False, index=True)
    provider = Column(String, nullable=False)
    status = Column(String, nullable=False, default="queued", index=True)
    prompt_hash = Column(String, nullable=True)
    prompt_text = Column(Text, nullable=True)
    request_json = Column(JSON, nullable=True)
    output = Column(Text, nullable=True)
    error_type = Column(String, nullable=True, index=True)
    error_message = Column(Text, nullable=True)
    tokens_in = Column(Integer, nullable=True)
    tokens_out = Column(Integer, nullable=True)
    cost_usd = Column(Float, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    retry_of_run_id = Column(Integer, ForeignKey("ai_runs.id"), nullable=True, index=True)
    professor_id = Column(Integer, ForeignKey("professors.id"), nullable=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=True, index=True)
    grant_id = Column(Integer, ForeignKey("grants.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)


# ───────────────────────────────────────────────────────────────────
# Recommenders & applications
# ───────────────────────────────────────────────────────────────────
class Recommender(Base):
    __tablename__ = "recommenders"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    relationship_kind = Column("relationship", String, nullable=True)  # avoid SQLAlchemy `relationship` clash
    affiliation = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Application(Base):
    __tablename__ = "applications"

    id = Column(Integer, primary_key=True)
    professor_id = Column(Integer, ForeignKey("professors.id"), nullable=True, index=True)
    title = Column(String, nullable=False)
    deadline = Column(Date, nullable=True)
    status = Column(String, nullable=False, default="planning", index=True)
    portal_url = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    submitted_at = Column(DateTime, nullable=True)

    professor = relationship("Professor", back_populates="applications")


class ApplicationRecommender(Base):
    __tablename__ = "application_recommenders"

    application_id = Column(Integer, ForeignKey("applications.id"), primary_key=True)
    recommender_id = Column(Integer, ForeignKey("recommenders.id"), primary_key=True)
    letter_status = Column(String, nullable=False, default="asked")
    letter_due_date = Column(Date, nullable=True)
    last_nudge_sent_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)


class ProfessorPaper(Base):
    __tablename__ = "professor_papers"

    id = Column(Integer, primary_key=True)
    professor_id = Column(Integer, ForeignKey("professors.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    venue = Column(String, nullable=True)
    year = Column(Integer, nullable=True)
    abstract = Column(Text, nullable=True)
    url = Column(String, nullable=True)
    pdf_url = Column(String, nullable=True)
    s2_id = Column(String, nullable=True)
    relevance_score = Column(Integer, nullable=True)   # 0-100, set by AI
    relevance_summary = Column(Text, nullable=True)    # 2-sentence why it matters to the user
    fetched_at = Column(DateTime, default=datetime.utcnow)

    professor = relationship("Professor", back_populates="papers")


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id = Column(Integer, primary_key=True)
    title = Column(String, nullable=False)
    date = Column(Date, nullable=False, index=True)
    time = Column(String, nullable=True)        # "HH:MM" 24h
    end_time = Column(String, nullable=True)    # "HH:MM" 24h
    description = Column(Text, nullable=True)
    color = Column(String, nullable=True)       # hex or CSS var name
    kind = Column(String, nullable=False, default="event")  # event|reminder|meeting|deadline
    all_day = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
