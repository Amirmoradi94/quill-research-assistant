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
)
from sqlalchemy.orm import relationship
from .database import Base


# ───────────────────────────────────────────────────────────────────
# Singletons (one row each)
# ───────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, default="")
    email = Column(String, nullable=True)
    current_role = Column(String, nullable=True)
    affiliation = Column(String, nullable=True)
    country = Column(String, nullable=True)
    research_interests = Column(Text, nullable=True)
    research_categories = Column(JSON, nullable=True)
    orcid = Column(String, nullable=True)
    scholar_url = Column(String, nullable=True)
    github = Column(String, nullable=True)
    website = Column(String, nullable=True)
    twitter = Column(String, nullable=True)
    phd_year = Column(Integer, nullable=True)
    phd_institution = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Settings(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True)
    ai_provider = Column(String, nullable=False, default="claude_cli")
    claude_cli_path = Column(String, nullable=True)
    codex_cli_path = Column(String, nullable=True)
    anthropic_api_key = Column(String, nullable=True)
    openai_api_key = Column(String, nullable=True)
    default_provider_per_workflow = Column(JSON, nullable=True)
    email_tone_rules = Column(Text, nullable=True)
    daily_cost_cap_usd = Column(Float, nullable=False, default=5.0)
    ui_density = Column(String, nullable=False, default="comfortable")


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

    professor = relationship("Professor", back_populates="drafts")
    ai_run = relationship("AIRun", foreign_keys=[ai_run_id])
    replies = relationship("EmailReply", back_populates="draft", cascade="all, delete-orphan")


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
    output = Column(Text, nullable=True)
    tokens_in = Column(Integer, nullable=True)
    tokens_out = Column(Integer, nullable=True)
    cost_usd = Column(Float, nullable=True)
    duration_ms = Column(Integer, nullable=True)
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


class EmailReply(Base):
    __tablename__ = "email_replies"

    id = Column(Integer, primary_key=True)
    draft_id = Column(Integer, ForeignKey("email_drafts.id"), nullable=False, index=True)
    thread_url = Column(String, nullable=True)
    received_at = Column(DateTime, nullable=True)
    content = Column(Text, nullable=True)
    classified_sentiment = Column(String, nullable=True)
    resulting_status_change = Column(String, nullable=True)

    draft = relationship("EmailDraft", back_populates="replies")
