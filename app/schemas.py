from datetime import date as _date, datetime
from typing import Any, Optional, List
from pydantic import BaseModel, ConfigDict


class ProfessorBase(BaseModel):
    number: Optional[int] = None
    name: str
    university: Optional[str] = ""
    dept_lab: Optional[str] = ""
    tier: Optional[str] = "T3"
    status: Optional[str] = "drafting"
    date_sent: Optional[_date] = None
    email: Optional[str] = ""
    research_angle: Optional[str] = ""
    notes: Optional[str] = ""
    priority: Optional[int] = 0
    profile_url: Optional[str] = ""
    research_interests: Optional[str] = ""
    research_category: Optional[str] = ""


class ProfessorCreate(ProfessorBase):
    pass


class ProfessorUpdate(BaseModel):
    number: Optional[int] = None
    name: Optional[str] = None
    university: Optional[str] = None
    dept_lab: Optional[str] = None
    tier: Optional[str] = None
    status: Optional[str] = None
    date_sent: Optional[_date] = None
    email: Optional[str] = None
    research_angle: Optional[str] = None
    notes: Optional[str] = None
    priority: Optional[int] = None
    profile_url: Optional[str] = None
    research_interests: Optional[str] = None
    research_category: Optional[str] = None
    position_type: Optional[str] = None
    prospective_url: Optional[str] = None
    hiring_signals: Optional[dict] = None
    hiring_notes: Optional[str] = None
    hiring_intel: Optional[dict] = None
    contact_instructions: Optional[str] = None
    is_suggested: Optional[bool] = None
    dismissed_at: Optional[datetime] = None


class ProfessorOut(ProfessorBase):
    id: int
    created_at: datetime
    updated_at: datetime
    # v1 redesign extensions
    scholar_url: Optional[str] = None
    twitter: Optional[str] = None
    lab_url: Optional[str] = None
    last_research_summary: Optional[str] = None
    research_summary_at: Optional[datetime] = None
    auto_filled_at: Optional[datetime] = None
    source: Optional[str] = "manual"
    is_suggested: Optional[bool] = False
    dismissed_at: Optional[datetime] = None
    match_score: Optional[int] = None
    # position targeting + hiring intelligence
    position_type: Optional[str] = None
    prospective_url: Optional[str] = None
    hiring_signals: Optional[dict] = None
    hiring_notes: Optional[str] = None
    hiring_intel: Optional[dict] = None
    contact_instructions: Optional[str] = None
    profile_scraped_at: Optional[datetime] = None
    # relevance scoring
    relevance_score: Optional[int] = None
    relevance_breakdown: Optional[dict] = None
    relevance_scored_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


class GrantBase(BaseModel):
    name: str
    deadline: Optional[str] = ""
    amount: Optional[str] = ""
    eligibility: Optional[str] = ""
    status: Optional[str] = "pending"
    notes: Optional[str] = ""
    url: Optional[str] = ""
    source: Optional[str] = "manual"
    match_score: Optional[int] = None
    matched_reasons: Optional[list] = None
    region: Optional[str] = None
    discipline_tags: Optional[list] = None


class GrantUpdate(BaseModel):
    name: Optional[str] = None
    deadline: Optional[str] = None
    amount: Optional[str] = None
    eligibility: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    url: Optional[str] = None
    source: Optional[str] = None
    match_score: Optional[int] = None
    matched_reasons: Optional[list] = None
    region: Optional[str] = None
    discipline_tags: Optional[list] = None


class GrantOut(GrantBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class ActivityBase(BaseModel):
    date: Optional[_date] = None
    action: str
    detail: Optional[str] = ""
    professor_id: Optional[int] = None


class ActivityOut(ActivityBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class DraftBase(BaseModel):
    professor_id: int
    subject: Optional[str] = ""
    body: Optional[str] = ""


class DraftUpdate(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None
    attachment_doc_ids: Optional[List[int]] = None


class DraftOut(DraftBase):
    id: int
    created_at: datetime
    updated_at: datetime
    skipped_at: Optional[datetime] = None
    attachment_doc_ids: Optional[List[int]] = None
    model_config = ConfigDict(from_attributes=True)


class DraftWithProfessor(DraftOut):
    professor_name: Optional[str] = ""
    professor_university: Optional[str] = ""
    professor_status: Optional[str] = ""
    professor_email: Optional[str] = ""
    professor_research_category: Optional[str] = ""
    sent_at: Optional[datetime] = None


class Stats(BaseModel):
    total: int
    by_status: dict
    by_tier: dict
    by_university: dict
    sent_count: int
    reply_count: int
    response_rate: float
    interview_count: int
    offer_count: int
    pending_followups: int


# ───────────────────────────────────────────────────────────────────
# User profile (rich)
# ───────────────────────────────────────────────────────────────────
class UserEducationIn(BaseModel):
    degree_level: str
    field: Optional[str] = None
    institution: Optional[str] = None
    department: Optional[str] = None
    start_date: Optional[_date] = None
    end_date: Optional[_date] = None
    is_current: Optional[bool] = False
    gpa: Optional[float] = None
    gpa_scale: Optional[float] = None
    honors: Optional[str] = None
    advisor_name: Optional[str] = None
    advisor_title: Optional[str] = None
    co_advisor_name: Optional[str] = None
    thesis_title: Optional[str] = None
    thesis_abstract: Optional[str] = None
    key_courses: Optional[List[dict]] = None
    transcript_doc_id: Optional[int] = None
    order_idx: Optional[int] = 0


class UserEducationOut(UserEducationIn):
    id: int
    model_config = ConfigDict(from_attributes=True)


class UserPublicationIn(BaseModel):
    title: str
    authors: Optional[str] = None
    venue_full_name: Optional[str] = None
    venue_short: Optional[str] = None
    year: Optional[int] = None
    type: Optional[str] = None
    status: Optional[str] = "published"
    doi: Optional[str] = None
    url: Optional[str] = None
    pdf_url: Optional[str] = None
    citation_count: Optional[int] = None
    your_role: Optional[str] = None
    abstract: Optional[str] = None
    one_line_takeaway: Optional[str] = None
    is_signature: Optional[bool] = False
    order_idx: Optional[int] = 0


class UserPublicationOut(UserPublicationIn):
    id: int
    model_config = ConfigDict(from_attributes=True)


class UserExperienceIn(BaseModel):
    title: str
    employer: Optional[str] = None
    lab_or_group: Optional[str] = None
    supervisor: Optional[str] = None
    location: Optional[str] = None
    start_date: Optional[_date] = None
    end_date: Optional[_date] = None
    is_current: Optional[bool] = False
    bullets: Optional[List[str]] = None
    tech_used: Optional[List[str]] = None
    order_idx: Optional[int] = 0


class UserExperienceOut(UserExperienceIn):
    id: int
    model_config = ConfigDict(from_attributes=True)


class UserAwardIn(BaseModel):
    name: str
    granting_body: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = "USD"
    year: Optional[int] = None
    type: Optional[str] = None
    notes: Optional[str] = None
    order_idx: Optional[int] = 0


class UserAwardOut(UserAwardIn):
    id: int
    model_config = ConfigDict(from_attributes=True)


class UserReferenceIn(BaseModel):
    name: str
    title: Optional[str] = None
    institution: Optional[str] = None
    email: Optional[str] = None
    relationship_type: Optional[str] = None
    years_known: Optional[int] = None
    notes: Optional[str] = None
    order_idx: Optional[int] = 0


class UserReferenceOut(UserReferenceIn):
    id: int
    model_config = ConfigDict(from_attributes=True)


class UserProfileUpdate(BaseModel):
    """PATCH /api/user — every field optional, partial update."""
    # Identity
    name: Optional[str] = None
    preferred_name: Optional[str] = None
    pronouns: Optional[str] = None
    headshot_url: Optional[str] = None
    # Contact
    email: Optional[str] = None
    email_secondary: Optional[str] = None
    phone: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    nationality: Optional[str] = None
    languages: Optional[List[dict]] = None
    # Online
    orcid: Optional[str] = None
    scholar_url: Optional[str] = None
    github: Optional[str] = None
    linkedin: Optional[str] = None
    website: Optional[str] = None
    twitter: Optional[str] = None
    # Current role
    current_role: Optional[str] = None
    affiliation: Optional[str] = None
    # Application target
    target_position_type: Optional[str] = None
    target_start_date: Optional[_date] = None
    earliest_available_date: Optional[_date] = None
    target_countries: Optional[List[str]] = None
    target_universities_preferred: Optional[List[str]] = None
    excluded_institutions: Optional[List[str]] = None
    funding_status: Optional[str] = None
    work_authorization: Optional[dict] = None
    commitment_length: Optional[str] = None
    # Research profile
    headline: Optional[str] = None
    research_interests: Optional[str] = None
    research_categories: Optional[List[str]] = None
    methods: Optional[List[str]] = None
    application_domains: Optional[List[str]] = None
    tools_frameworks: Optional[List[str]] = None
    datasets_used: Optional[List[str]] = None
    datasets_created: Optional[List[dict]] = None
    # Skills
    programming_languages: Optional[List[dict]] = None
    certifications: Optional[List[str]] = None
    reviewing_venues: Optional[List[str]] = None
    teaching_summary: Optional[str] = None
    # Legacy
    phd_year: Optional[int] = None
    phd_institution: Optional[str] = None
    # Linked docs
    cv_doc_id: Optional[int] = None
    research_statement_doc_id: Optional[int] = None
    transcript_doc_ids: Optional[List[int]] = None
    sample_paper_doc_ids: Optional[List[int]] = None


class UserProfileOut(UserProfileUpdate):
    """Full profile + nested repeatables. Returned by GET /api/user."""
    id: int
    created_at: datetime
    updated_at: datetime
    cv_last_extracted_at: Optional[datetime] = None
    field_provenance: Optional[dict] = None
    education: List[UserEducationOut] = []
    publications: List[UserPublicationOut] = []
    experience: List[UserExperienceOut] = []
    awards: List[UserAwardOut] = []
    references: List[UserReferenceOut] = []
    model_config = ConfigDict(from_attributes=True)


class DiscoveryRunOut(BaseModel):
    id: int
    status: str
    phase: str
    position_type: Optional[str] = None
    target_countries: Optional[List[str]] = None
    target_departments: Optional[List[str]] = None
    filters: Optional[dict[str, Any]] = None
    universities_total: int = 0
    universities_checked: int = 0
    departments_found: int = 0
    directory_pages_found: int = 0
    pages_crawled: int = 0
    candidates_extracted: int = 0
    candidates_verified: int = 0
    candidates_rejected: int = 0
    professors_saved: int = 0
    failures: int = 0
    summary: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class DiscoveryRunCreate(BaseModel):
    position_type: Optional[str] = None
    target_countries: Any = None
    target_departments: Any = None
    filters: Optional[dict[str, Any]] = None


class DiscoveryUniversityOut(BaseModel):
    id: int
    run_id: int
    name: str
    normalized_name: str
    country: str
    country_code: Optional[str] = None
    region: Optional[str] = None
    official_domain: Optional[str] = None
    official_url: Optional[str] = None
    source: Optional[str] = None
    source_url: Optional[str] = None
    source_confidence: Optional[float] = None
    status: str
    error_message: Optional[str] = None
    discovered_at: Optional[datetime] = None
    checked_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class DiscoveryDepartmentOut(BaseModel):
    id: int
    run_id: int
    university_id: int
    name: str
    normalized_name: str
    school: Optional[str] = None
    url: Optional[str] = None
    domain: Optional[str] = None
    source: Optional[str] = None
    relevance_keywords: Optional[List[str]] = None
    status: str
    error_message: Optional[str] = None
    discovered_at: Optional[datetime] = None
    crawled_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class DiscoveryPageOut(BaseModel):
    id: int
    run_id: int
    university_id: Optional[int] = None
    department_id: Optional[int] = None
    url: str
    normalized_url: str
    final_url: Optional[str] = None
    page_type: str
    status: str
    depth: int
    fetcher: Optional[str] = None
    http_status: Optional[int] = None
    content_hash: Optional[str] = None
    title: Optional[str] = None
    discovered_from_url: Optional[str] = None
    extracted_count: int = 0
    error_message: Optional[str] = None
    first_seen_at: Optional[datetime] = None
    last_crawled_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class DiscoveryCandidateOut(BaseModel):
    id: int
    run_id: int
    university_id: Optional[int] = None
    department_id: Optional[int] = None
    source_page_id: Optional[int] = None
    professor_id: Optional[int] = None
    name: str
    normalized_name: str
    title: Optional[str] = None
    rank: Optional[str] = None
    university_name: Optional[str] = None
    country: Optional[str] = None
    dept_lab: Optional[str] = None
    email: Optional[str] = None
    profile_url: Optional[str] = None
    lab_url: Optional[str] = None
    scholar_url: Optional[str] = None
    research_text: Optional[str] = None
    evidence_summary: Optional[str] = None
    raw_payload: Optional[dict[str, Any]] = None
    extraction_confidence: Optional[float] = None
    verification_status: str
    rejection_reason: Optional[str] = None
    match_score: Optional[int] = None
    matched_reasons: Optional[List[str]] = None
    scored_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class DiscoveryCoverageOut(BaseModel):
    active_run: Optional[DiscoveryRunOut] = None
    latest_run: Optional[DiscoveryRunOut] = None
    totals: dict[str, int]
    recent_logs: List[dict[str, Any]] = []
